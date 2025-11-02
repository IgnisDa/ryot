import { createHmac } from "node:crypto";

import { base32 } from "rfc4648";

import { requireNonEmptyArray, requirePresent, requireString } from "../test-support/assertions";

type TwoFactorSetupResult = {
	cookies: string;
	backupCodes: string[];
	totpCodes: { past: string; current: string; future: string };
};

export function cookieHeaderFromSetCookies(setCookies: string[]) {
	return setCookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

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

	const hmac = createHmac("sha1", key).update(counterBuffer).digest();
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
	const enableResponse = await fetch(`${input.baseUrl}/auth/two-factor/enable`, {
		method: "POST",
		headers: {
			Cookie: input.cookies,
			"Content-Type": "application/json",
			...(input.origin ? { Origin: input.origin } : {}),
		},
		body: JSON.stringify({ password: input.password, issuer: input.issuer ?? "Ryot" }),
	});

	if (!enableResponse.ok) {
		const error = await enableResponse.text();
		throw new Error(`Two-factor enable failed: ${error}`);
	}

	const enableData: Record<string, unknown> = await enableResponse.json();
	if (typeof enableData !== "object") {
		throw new Error("Two-factor enable returned an invalid response");
	}

	const totpURI = requireString(
		enableData.totpURI,
		"Two-factor enable succeeded but no TOTP URI was returned",
	);
	const totpSecret = parseTotpSecret(totpURI);
	const totpCodes = generateTotpWindowCodes(totpSecret);

	if (!Array.isArray(enableData.backupCodes)) {
		throw new Error("Two-factor enable returned an invalid response");
	}
	const backupCodes = enableData.backupCodes.filter(
		(code): code is string => typeof code === "string",
	);

	requireNonEmptyArray(
		backupCodes,
		"Two-factor enable succeeded but no backup codes were returned",
	);

	const verifyResponse = await fetch(`${input.baseUrl}/auth/two-factor/verify-totp`, {
		method: "POST",
		body: JSON.stringify({ code: generateTotpCode(totpSecret) }),
		headers: {
			Cookie: input.cookies,
			"Content-Type": "application/json",
			...(input.origin ? { Origin: input.origin } : {}),
		},
	});

	if (!verifyResponse.ok) {
		const error = await verifyResponse.text();
		throw new Error(`Two-factor verification failed: ${error}`);
	}

	const setCookies = verifyResponse.headers.getSetCookie();

	return {
		totpCodes,
		backupCodes,
		cookies: setCookies.length ? cookieHeaderFromSetCookies(setCookies) : input.cookies,
	};
}
