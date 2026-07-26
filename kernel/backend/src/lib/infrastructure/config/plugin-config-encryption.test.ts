import { expect, it } from "@effect/vitest";
import { Effect, Result } from "effect";

import { createPluginConfigEncryption } from "./plugin-config-encryption";

const oldKey = { id: "old", key: Buffer.alloc(32, 17) };
const newKey = { id: "new", key: Buffer.alloc(32, 29) };
const owner = {
	id: "config-1",
	scope: "installation",
	ownerUserId: "user-1",
	pluginRevisionId: "revision-1",
};

it.effect("encrypts complete configuration and authenticates its immutable ownership", () =>
	Effect.gen(function* () {
		const keys = createPluginConfigEncryption(oldKey);
		const value = {
			missing: null,
			apiKey: "private-token",
			nested: { threshold: 0, enabled: false },
		};
		const encrypted = yield* keys.encrypt(value, owner);
		expect(encrypted.encryptedPayload.toString()).not.toContain("private-token");
		expect(yield* keys.decrypt(encrypted, owner)).toEqual(value);
		const wrongOwner = yield* Effect.result(
			keys.decrypt(encrypted, { ...owner, ownerUserId: "other-user" }),
		);
		expect(Result.isFailure(wrongOwner)).toBe(true);
	}),
);

it.effect("decrypts historical payloads with an independent encryption instance", () =>
	Effect.gen(function* () {
		const before = createPluginConfigEncryption(oldKey);
		const after = createPluginConfigEncryption(oldKey);
		const encrypted = yield* before.encrypt({ password: "historical" }, owner);
		expect(yield* after.decrypt(encrypted, owner)).toEqual({ password: "historical" });
		expect((yield* after.encrypt({}, owner)).encryptionKeyId).toBe("old");
		expect(yield* after.fingerprint({ password: "historical" })).toBe(
			yield* before.fingerprint({ password: "historical" }),
		);
	}),
);

it.effect(
	"rejects missing keys, wrong key material, altered ciphertext, nonce, and pruned payloads",
	() =>
		Effect.gen(function* () {
			const keys = createPluginConfigEncryption(oldKey);
			const encrypted = yield* keys.encrypt({ password: "never-in-errors" }, owner);
			const changed = Buffer.from(encrypted.encryptedPayload);
			changed[0] = (changed[0] ?? 0) ^ 1;
			const results = yield* Effect.forEach(
				[
					createPluginConfigEncryption(newKey).decrypt(encrypted, owner),
					createPluginConfigEncryption({ ...newKey, id: "old" }).decrypt(encrypted, owner),
					keys.decrypt({ ...encrypted, encryptedPayload: changed }, owner),
					keys.decrypt({ ...encrypted, nonce: Buffer.alloc(12) }, owner),
					keys.decrypt({ ...encrypted, encryptedPayload: null }, owner),
				],
				Effect.result,
			);
			for (const result of results) {
				expect(Result.isFailure(result)).toBe(true);
				if (Result.isFailure(result)) {
					expect(result.failure.message).not.toContain("never-in-errors");
				}
			}
		}),
);

it.effect("reuses canonical fingerprints without making encryption deterministic", () =>
	Effect.gen(function* () {
		const keys = createPluginConfigEncryption(oldKey);
		expect(yield* keys.fingerprint({ first: 1, second: 2 })).toBe(
			yield* keys.fingerprint({ first: 1, second: 2 }),
		);
		expect(yield* keys.fingerprint({ first: 1 })).not.toBe(
			yield* createPluginConfigEncryption(newKey).fingerprint({ first: 1 }),
		);
		const a = yield* keys.encrypt({ first: 1 }, owner);
		const b = yield* keys.encrypt({ first: 1 }, owner);
		expect(a.nonce).not.toEqual(b.nonce);
		expect(a.encryptedPayload).not.toEqual(b.encryptedPayload);
	}),
);

it("rejects malformed persisted keys without exposing supplied values", () => {
	for (const input of [
		{ key: Buffer.alloc(32), id: "private-invalid-id!" },
		{ id: "private-id", key: Buffer.from("secret-short") },
	]) {
		expect(() => createPluginConfigEncryption(input)).toThrow(
			"Invalid persisted plugin configuration encryption key",
		);
		try {
			createPluginConfigEncryption(input);
		} catch (error) {
			expect(String(error)).not.toContain(input.id);
			expect(String(error)).not.toContain(input.key.toString());
		}
	}
});
