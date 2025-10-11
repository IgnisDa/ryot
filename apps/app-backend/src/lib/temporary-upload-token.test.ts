import { describe, expect, it } from "bun:test";

import {
	claimUploadToken,
	storeUploadToken,
	UPLOAD_TOKEN_TTL_SECONDS,
} from "./temporary-upload-token";

type FakeRedis = {
	store: Map<string, { value: string; ttl: number }>;
	set(key: string, value: string, exFlag: "EX", ttl: number): Promise<"OK">;
	get(key: string): Promise<string | null>;
	del(key: string): Promise<number>;
};

const createFakeRedis = (): FakeRedis => {
	const store = new Map<string, { value: string; ttl: number }>();
	return {
		store,
		set: (key, value, _exFlag, ttl) => {
			store.set(key, { value, ttl });
			return Promise.resolve("OK" as const);
		},
		get: (key) => {
			const entry = store.get(key);
			return Promise.resolve(entry?.value ?? null);
		},
		del: (key) => {
			const existed = store.has(key);
			store.delete(key);
			return Promise.resolve(existed ? 1 : 0);
		},
	};
};

describe("storeUploadToken", () => {
	it("stores the token with the given userId and resolvedPath", async () => {
		const fakeRedis = createFakeRedis();
		const token = await storeUploadToken(
			{ userId: "user_1", resolvedPath: "/tmp/ryot/abc.csv" },
			{ redis: fakeRedis, generateToken: () => "tok_123" },
		);

		expect(token).toBe("tok_123");
		expect(fakeRedis.store.size).toBe(1);
		const entry = fakeRedis.store.get("import:upload:token:tok_123");
		expect(entry?.ttl).toBe(UPLOAD_TOKEN_TTL_SECONDS);
		expect(JSON.parse(entry?.value ?? "{}")).toEqual({
			userId: "user_1",
			resolvedPath: "/tmp/ryot/abc.csv",
		});
	});

	it("generates a unique token per call", async () => {
		const fakeRedis = createFakeRedis();
		let seq = 0;
		const deps = { redis: fakeRedis, generateToken: () => `tok_${++seq}` };

		const t1 = await storeUploadToken({ userId: "user_1", resolvedPath: "/tmp/a.csv" }, deps);
		const t2 = await storeUploadToken({ userId: "user_1", resolvedPath: "/tmp/b.csv" }, deps);

		expect(t1).toBe("tok_1");
		expect(t2).toBe("tok_2");
		expect(fakeRedis.store.size).toBe(2);
	});
});

describe("claimUploadToken", () => {
	it("returns the resolvedPath and deletes the key on a valid claim", async () => {
		const fakeRedis = createFakeRedis();
		const token = await storeUploadToken(
			{ userId: "user_1", resolvedPath: "/tmp/ryot/abc.csv" },
			{ redis: fakeRedis, generateToken: () => "tok_abc" },
		);

		const result = await claimUploadToken(token, "user_1", { redis: fakeRedis });

		expect(result).toEqual({ resolvedPath: "/tmp/ryot/abc.csv" });
		expect(fakeRedis.store.has("import:upload:token:tok_abc")).toBe(false);
	});

	it("is single-use: a second claim returns an error", async () => {
		const fakeRedis = createFakeRedis();
		const token = await storeUploadToken(
			{ userId: "user_1", resolvedPath: "/tmp/ryot/abc.csv" },
			{ redis: fakeRedis, generateToken: () => "tok_once" },
		);

		await claimUploadToken(token, "user_1", { redis: fakeRedis });
		const second = await claimUploadToken(token, "user_1", { redis: fakeRedis });

		expect(second).toEqual({ error: "Upload token is invalid or has expired" });
	});

	it("rejects a claim from a different user without deleting the key", async () => {
		const fakeRedis = createFakeRedis();
		const token = await storeUploadToken(
			{ userId: "user_1", resolvedPath: "/tmp/ryot/abc.csv" },
			{ redis: fakeRedis, generateToken: () => "tok_owned" },
		);

		const result = await claimUploadToken(token, "user_2", { redis: fakeRedis });

		expect(result).toEqual({ error: "Upload token does not belong to this user" });
		// Key must still exist so the rightful owner can still claim it
		expect(fakeRedis.store.has("import:upload:token:tok_owned")).toBe(true);
	});

	it("returns an error for an unknown token", async () => {
		const fakeRedis = createFakeRedis();
		const result = await claimUploadToken("tok_missing", "user_1", { redis: fakeRedis });

		expect(result).toEqual({ error: "Upload token is invalid or has expired" });
	});

	it("returns an error for a corrupted token value", async () => {
		const fakeRedis = createFakeRedis();
		fakeRedis.store.set("import:upload:token:tok_corrupt", { value: "not-json{{", ttl: 900 });

		const result = await claimUploadToken("tok_corrupt", "user_1", { redis: fakeRedis });

		expect(result).toEqual({ error: "Upload token is invalid or has expired" });
		expect(fakeRedis.store.has("import:upload:token:tok_corrupt")).toBe(false);
	});
});
