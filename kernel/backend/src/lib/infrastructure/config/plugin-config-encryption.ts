import { stableStringify } from "@ryot-app/ts-utils/json";
import { Data, Effect, Schema } from "effect";

export class PluginConfigCryptoError extends Data.TaggedError("PluginConfigCryptoError")<{
	readonly message: string;
}> {}

const encode = (value: unknown) => new TextEncoder().encode(stableStringify(value));

export const createPluginConfigEncryption = (entry: { id: string; key: Uint8Array }) => {
	if (!/^[a-zA-Z0-9_-]{1,64}$/.test(entry.id) || entry.key.length !== 32) {
		throw new Error("Invalid persisted plugin configuration encryption key");
	}
	const activeKeyId = entry.id;
	const keyMaterial = Buffer.from(entry.key);
	const getKey = (id: string) => {
		if (id !== activeKeyId) {
			throw new Error("A retained plugin configuration requires an unavailable encryption key");
		}
		return keyMaterial;
	};
	const operation = <A>(run: () => Promise<A>) =>
		Effect.tryPromise({
			try: run,
			catch: () =>
				new PluginConfigCryptoError({ message: "Plugin configuration cryptography failed" }),
		});
	const fingerprint = (value: unknown) =>
		Effect.gen(function* () {
			const material = yield* operation(() =>
				crypto.subtle.importKey("raw", new Uint8Array(keyMaterial), "HKDF", false, ["deriveKey"]),
			);
			const key = yield* operation(() =>
				crypto.subtle.deriveKey(
					{
						name: "HKDF",
						hash: "SHA-256",
						salt: new Uint8Array(),
						info: new TextEncoder().encode("ryot/plugin-config/fingerprint"),
					},
					material,
					{ length: 256, name: "HMAC", hash: "SHA-256" },
					false,
					["sign"],
				),
			);
			return Buffer.from(
				yield* operation(() => crypto.subtle.sign("HMAC", key, encode(value))),
			).toString("hex");
		});
	return {
		fingerprint,
		activeKeyId,
		hasKey: (id: string) => id === activeKeyId,
		encrypt: (value: unknown, attribution: unknown) =>
			Effect.gen(function* () {
				const nonce = crypto.getRandomValues(new Uint8Array(12));
				const key = yield* operation(() =>
					crypto.subtle.importKey("raw", new Uint8Array(getKey(activeKeyId)), "AES-GCM", false, [
						"encrypt",
					]),
				);
				const encryptedPayload = Buffer.from(
					yield* operation(() =>
						crypto.subtle.encrypt(
							{ iv: nonce, tagLength: 128, name: "AES-GCM", additionalData: encode(attribution) },
							key,
							encode(value),
						),
					),
				);
				return { encryptedPayload, nonce: Buffer.from(nonce), encryptionKeyId: activeKeyId };
			}),
		decrypt: (
			envelope: { encryptionKeyId: string; nonce: Uint8Array; encryptedPayload: Uint8Array | null },
			attribution: unknown,
		) =>
			Effect.gen(function* () {
				const key = yield* Effect.try({
					try: () => getKey(envelope.encryptionKeyId),
					catch: () =>
						new PluginConfigCryptoError({
							message: "A retained plugin configuration requires an unavailable encryption key",
						}),
				});
				if (!envelope.encryptedPayload) {
					return yield* new PluginConfigCryptoError({
						message: "Plugin configuration payload has been pruned",
					});
				}
				const ciphertext = new Uint8Array(envelope.encryptedPayload);
				if (envelope.nonce.length !== 12 || ciphertext.length < 16) {
					return yield* new PluginConfigCryptoError({
						message: "Plugin configuration authentication failed",
					});
				}
				const imported = yield* operation(() =>
					crypto.subtle.importKey("raw", new Uint8Array(key), "AES-GCM", false, ["decrypt"]),
				);
				const plaintext = yield* operation(() =>
					crypto.subtle.decrypt(
						{
							tagLength: 128,
							name: "AES-GCM",
							iv: new Uint8Array(envelope.nonce),
							additionalData: encode(attribution),
						},
						imported,
						ciphertext,
					),
				);
				return yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(
					new TextDecoder().decode(plaintext),
				).pipe(
					Effect.mapError(
						() =>
							new PluginConfigCryptoError({
								message: "Plugin configuration authentication failed",
							}),
					),
				);
			}),
	};
};
