import { hmacDigest } from "@ryot/ts-utils/crypto";
import { base32 } from "rfc4648";

import { requireNonEmptyArray, requirePresent, requireString } from "~/support/assertions";

import { cookieHeaderFromSetCookies, createTestAuthClient } from "./auth";

type TwoFactorSetupResult = {
	cookies: string;
	backupCodes: string[];
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

function generateTotpCode(secret: string, timeOffset = 0) {
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

export async function enableTwoFactorForSession(input: {
	baseUrl: string;
	origin?: string;
	cookies: string;
	issuer?: string;
	password: string;
}): Promise<TwoFactorSetupResult> {
	let setCookies: string[] = [];
	const authClient = createTestAuthClient(input.baseUrl, {
		cookies: input.cookies,
		origin: input.origin,
		onSetCookies: (nextCookies) => {
			setCookies = nextCookies;
		},
	});
	const { data: enableData, error: enableError } = await authClient.twoFactor.enable({
		password: input.password,
		issuer: input.issuer ?? "Ryot",
	});
	if (enableError) {
		throw new Error(`Two-factor enable failed: ${enableError.message}`);
	}
	const totpURI = requireString(
		requirePresent(enableData, "Two-factor enable returned no data").totpURI,
		"Two-factor enable succeeded but no TOTP URI was returned",
	);
	const totpSecret = parseTotpSecret(totpURI);
	const totpCodes = generateTotpWindowCodes(totpSecret);
	const backupCodes = enableData.backupCodes;

	requireNonEmptyArray(
		backupCodes,
		"Two-factor enable succeeded but no backup codes were returned",
	);

	const { error: verifyError } = await authClient.twoFactor.verifyTotp({
		code: generateTotpCode(totpSecret),
	});
	if (verifyError) {
		throw new Error(`Two-factor verification failed: ${verifyError.message}`);
	}

	return {
		totpCodes,
		backupCodes,
		cookies: setCookies.length ? cookieHeaderFromSetCookies(setCookies) : input.cookies,
	};
}

export async function verifyBackupCodeForSession(input: {
	code: string;
	cookies: string;
	baseUrl: string;
}) {
	let setCookies: string[] = [];
	const authClient = createTestAuthClient(input.baseUrl, {
		cookies: input.cookies,
		onSetCookies: (nextCookies) => {
			setCookies = nextCookies;
		},
	});
	const result = await authClient.twoFactor.verifyBackupCode({ code: input.code });
	return {
		...result,
		cookies: setCookies.length ? cookieHeaderFromSetCookies(setCookies) : input.cookies,
	};
}
