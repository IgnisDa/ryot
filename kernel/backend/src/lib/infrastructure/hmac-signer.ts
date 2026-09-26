import { Context, Effect, Layer, Redacted } from "effect";

import { AppConfig } from "./config/service";

const encodeBase64Url = (bytes: Uint8Array) => {
	let value = "";
	for (const byte of bytes) {
		value += String.fromCharCode(byte);
	}
	return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

const decodeBase64Url = (value: string) => {
	if (!/^[A-Za-z0-9_-]+$/.test(value)) {
		return null;
	}
	const padded = value
		.replaceAll("-", "+")
		.replaceAll("_", "/")
		.padEnd(Math.ceil(value.length / 4) * 4, "=");
	try {
		const decoded = atob(padded);
		return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
	} catch {
		return null;
	}
};

export class HmacSigner extends Context.Service<HmacSigner>()("HmacSigner", {
	make: Effect.gen(function* () {
		const config = yield* AppConfig;
		const signingKey = yield* Effect.tryPromise(() =>
			crypto.subtle.importKey(
				"raw",
				new TextEncoder().encode(Redacted.value(config.server.adminAccessToken)),
				{ name: "HMAC", hash: "SHA-256" },
				false,
				["sign", "verify"],
			),
		).pipe(Effect.orDie);

		const sign = Effect.fn("HmacSigner.sign")(function* (payload: string) {
			const signature = yield* Effect.tryPromise(() =>
				crypto.subtle.sign("HMAC", signingKey, new TextEncoder().encode(payload)),
			).pipe(Effect.orDie);
			return encodeBase64Url(new Uint8Array(signature));
		});

		const verify = Effect.fn("HmacSigner.verify")(function* (payload: string, signature: string) {
			const bytes = decodeBase64Url(signature);
			if (bytes === null) {
				return false;
			}
			return yield* Effect.tryPromise(() =>
				crypto.subtle.verify("HMAC", signingKey, bytes, new TextEncoder().encode(payload)),
			).pipe(Effect.orDie);
		});

		return { sign, verify };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
