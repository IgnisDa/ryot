import { describe, expect, it } from "bun:test";

import { redis } from "~/lib/redis";
import { redisKeys, redisValues } from "~/lib/redis-keys";
import { apiFailure, apiSuccess } from "~/lib/sandbox/types";

import { claimCachedValue } from "./claim-cached-value";

const ctx = { scriptId: "test-script" };

describe("claimCachedValue", () => {
	it("claims the key and returns claimed: true on first call", async () => {
		let setArgs: { key: string; value: string; mode: string; ex: number } | undefined;
		const originalSet = redis.set.bind(redis);

		// oxlint-disable-next-line no-unsafe-type-assertion
		redis.set = ((...args: unknown[]) => {
			setArgs = {
				// oxlint-disable no-unsafe-type-assertion
				ex: args[3] as number,
				key: args[0] as string,
				mode: args[4] as string,
				value: args[1] as string,
				// oxlint-enable no-unsafe-type-assertion
			};
			return Promise.resolve("OK");
		}) as never;

		try {
			const result = await claimCachedValue(ctx, "song-key", { title: "Test" }, 3600);
			expect(result).toEqual(apiSuccess({ claimed: true }));
			expect(setArgs?.key).toBe(redisKeys.sandbox.cache("test-script", "song-key"));
			expect(setArgs?.mode).toBe("NX");
			expect(setArgs?.ex).toBe(3600);
			expect(redisValues.sandbox.cache.parse(setArgs?.value ?? "null")).toEqual({ title: "Test" });
		} finally {
			redis.set = originalSet;
		}
	});

	it("returns claimed: false with existing value when key already exists", async () => {
		const originalSet = redis.set.bind(redis);
		const originalGet = redis.get.bind(redis);
		const storedValue = redisValues.sandbox.cache.stringify({ title: "Existing" });

		// oxlint-disable-next-line no-unsafe-type-assertion
		redis.set = (() => Promise.resolve(null)) as never;
		// oxlint-disable-next-line no-unsafe-type-assertion
		redis.get = (() => Promise.resolve(storedValue)) as never;

		try {
			const result = await claimCachedValue(ctx, "song-key", { title: "New" }, 3600);
			expect(result).toEqual(apiSuccess({ claimed: false, value: { title: "Existing" } }));
		} finally {
			redis.set = originalSet;
			redis.get = originalGet;
		}
	});

	it("returns claimed: false with null value when key exists but was deleted between SET and GET", async () => {
		const originalSet = redis.set.bind(redis);
		const originalGet = redis.get.bind(redis);

		// oxlint-disable-next-line no-unsafe-type-assertion
		redis.set = (() => Promise.resolve(null)) as never;
		// oxlint-disable-next-line no-unsafe-type-assertion
		redis.get = (() => Promise.resolve(null)) as never;

		try {
			const result = await claimCachedValue(ctx, "song-key", "value", 60);
			expect(result).toEqual(apiSuccess({ claimed: false, value: null }));
		} finally {
			redis.set = originalSet;
			redis.get = originalGet;
		}
	});

	it("trims whitespace from the key before using it", async () => {
		let capturedKey: string | undefined;
		const originalSet = redis.set.bind(redis);

		// oxlint-disable-next-line no-unsafe-type-assertion
		redis.set = ((...args: unknown[]) => {
			// oxlint-disable-next-line no-unsafe-type-assertion
			capturedKey = args[0] as string;
			return Promise.resolve("OK");
		}) as never;

		try {
			await claimCachedValue(ctx, "  trimmed-key  ", "value", 30);
			expect(capturedKey).toBe(redisKeys.sandbox.cache("test-script", "trimmed-key"));
		} finally {
			redis.set = originalSet;
		}
	});

	it("returns failure for a blank key", async () => {
		expect(await claimCachedValue(ctx, "   ", "value", 60)).toEqual(
			apiFailure("claimCachedValue expects a non-empty key string"),
		);
	});

	it("returns failure when the context has no scriptId", async () => {
		expect(await claimCachedValue({ scriptId: "   " }, "key", "value", 60)).toEqual(
			apiFailure("claimCachedValue requires a non-empty scriptId in context"),
		);
	});

	it("returns failure for a zero ttlSeconds", async () => {
		expect(await claimCachedValue(ctx, "key", "value", 0)).toEqual(
			apiFailure("claimCachedValue expects a positive integer ttlSeconds"),
		);
	});

	it("returns failure for a negative ttlSeconds", async () => {
		expect(await claimCachedValue(ctx, "key", "value", -10)).toEqual(
			apiFailure("claimCachedValue expects a positive integer ttlSeconds"),
		);
	});

	it("returns failure for a fractional ttlSeconds", async () => {
		expect(await claimCachedValue(ctx, "key", "value", 1.5)).toEqual(
			apiFailure("claimCachedValue expects a positive integer ttlSeconds"),
		);
	});

	it("returns failure for a non-serializable value", async () => {
		expect(await claimCachedValue(ctx, "key", undefined, 60)).toEqual(
			apiFailure("claimCachedValue value must be JSON-serializable"),
		);
	});

	it("returns failure when redis throws", async () => {
		const originalSet = redis.set.bind(redis);
		// oxlint-disable-next-line no-unsafe-type-assertion
		redis.set = (() => {
			throw new Error("connection failed");
		}) as never;

		try {
			expect(await claimCachedValue(ctx, "key", "value", 60)).toEqual(
				apiFailure("connection failed"),
			);
		} finally {
			redis.set = originalSet;
		}
	});
});
