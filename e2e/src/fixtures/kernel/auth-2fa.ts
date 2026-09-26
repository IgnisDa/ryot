import { hmacDigest } from "@ryot-app/ts-utils/crypto";
import { Effect, Schema } from "effect";
import { base32 } from "rfc4648";

import { requireNonEmptyArray, requirePresent, requireString } from "~/support/assertions";

import { completeTwoFactorSignIn, createTestAuthClient } from "./auth";

type TwoFactorSetupResult = {
	token: string;
	backupCodes: string[];
	sessionCookie: string;
	totpCodes: { past: string; current: string; future: string };
};

function parseTotpSecret(totpURI: string) {
	let url: URL;
	try {
		url = new URL(totpURI);
	} catch {
		throw new Error(`Invalid TOTP URI returned by the server: ${totpURI}`);
	}

	const secret = url.searchParams.get("secret");
	return requirePresent(secret, `TOTP URI did not include a secret: ${totpURI}`);
}

function decodeBase32(value: string) {
	const normalized = value.toUpperCase().replace(/=+$/u, "").replace(/\s+/gu, "");
	return Buffer.from(base32.parse(normalized, { loose: true }));
}

export function generateTotpCode(secret: string, timeOffset = 0) {
	const counter = Math.floor(Date.now() / 1000 / 30) + timeOffset;
	const counterBuffer = Buffer.alloc(8);
	const key = decodeBase32(secret);

	counterBuffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
	counterBuffer.writeUInt32BE(counter >>> 0, 4);

	const hmac = hmacDigest("sha1", key, counterBuffer);
	const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
	const byte0 = hmac[offset] ?? 0;
	const byte1 = hmac[offset + 1] ?? 0;
	const byte2 = hmac[offset + 2] ?? 0;
	const byte3 = hmac[offset + 3] ?? 0;
	const binaryCode =
		((byte0 & 0x7f) << 24) | ((byte1 & 0xff) << 16) | ((byte2 & 0xff) << 8) | (byte3 & 0xff);

	return (binaryCode % 1_000_000).toString().padStart(6, "0");
}

function generateTotpWindowCodes(secret: string) {
	return {
		current: generateTotpCode(secret),
		past: generateTotpCode(secret, -1),
		future: generateTotpCode(secret, 1),
	};
}

export const enableTwoFactorForSessionEffect = (input: {
	token: string;
	baseUrl: string;
	origin?: string;
	issuer?: string;
	password: string;
	sessionCookie: string;
}) =>
	Effect.gen(function* () {
		let sessionCookie = input.sessionCookie;
		const authClient = createTestAuthClient(input.baseUrl, {
			sessionCookie,
			origin: input.origin,
			onSessionCookie: (cookie) => {
				sessionCookie = cookie;
			},
		});
		const { data: enableData, error: enableError } = yield* Effect.promise(() =>
			authClient.twoFactor.enable({
				method: "totp",
				password: input.password,
				issuer: input.issuer ?? "Ryot",
			}),
		);
		if (enableError) {
			throw new Error(
				`Two-factor enable failed: ${yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(enableError)}`,
			);
		}
		const enabled = requirePresent(enableData, "Two-factor enable returned no data");
		if (enabled.method !== "totp") {
			throw new Error(`Two-factor enable returned unexpected method: ${enabled.method}`);
		}
		const totpURI = requireString(
			enabled.totpURI,
			"Two-factor enable succeeded but no TOTP URI was returned",
		);
		const totpSecret = parseTotpSecret(totpURI);
		const totpCodes = generateTotpWindowCodes(totpSecret);
		const backupCodes = enabled.backupCodes;

		requireNonEmptyArray(
			backupCodes,
			"Two-factor enable succeeded but no backup codes were returned",
		);

		const { error: verifyError } = yield* Effect.promise(() =>
			authClient.twoFactor.verifyTotp({ code: generateTotpCode(totpSecret) }),
		);
		if (verifyError) {
			throw new Error(`Two-factor verification failed: ${verifyError.message}`);
		}

		return {
			totpCodes,
			backupCodes,
			sessionCookie,
			token: input.token,
		} satisfies TwoFactorSetupResult;
	});

// The untouched seed script is a Promise-facing command-line entrypoint.
export const enableTwoFactorForSession = (
	input: Parameters<typeof enableTwoFactorForSessionEffect>[0],
) => Effect.runPromise(enableTwoFactorForSessionEffect(input));

export const verifyBackupCodeForSession = (input: {
	code: string;
	token: string;
	baseUrl: string;
	twoFactorToken?: string;
}) =>
	Effect.gen(function* () {
		const twoFactorToken = requirePresent(
			input.twoFactorToken,
			"Missing two-factor browser cookie",
		);
		const { data, token, response, sessionCookie } = yield* completeTwoFactorSignIn(
			input.baseUrl,
			twoFactorToken,
			"/two-factor/verify-backup-code",
			{ code: input.code },
		);
		return {
			sessionCookie,
			token: token ?? input.token,
			data: response.ok ? data : null,
			error: response.ok ? null : data,
		};
	});
