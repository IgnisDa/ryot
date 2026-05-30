import { describe, expect, it } from "bun:test";

import { redis } from "~/lib/redis";
import { redisValues } from "~/lib/redis-keys";
import { apiFailure, apiSuccess } from "~/lib/sandbox/types";

import { getCachedValue } from "./get-cached-value";

const ctx = { scriptId: "test-script" };

describe("getCachedValue", () => {
	it("returns the parsed cached value when the key exists", async () => {
		const originalGet = redis.get.bind(redis);
		// oxlint-disable-next-line no-unsafe-type-assertion
		redis.get = (() =>
			Promise.resolve(redisValues.sandbox.cache.stringify({ cached: true }))) as never;
		try {
			expect(await getCachedValue(ctx, "my-key")).toEqual(apiSuccess({ cached: true }));
		} finally {
			redis.get = originalGet;
		}
	});

	it("returns the stored null value when the key exists", async () => {
		const originalGet = redis.get.bind(redis);
		// oxlint-disable-next-line no-unsafe-type-assertion
		redis.get = (() => Promise.resolve(redisValues.sandbox.cache.stringify(null))) as never;
		try {
			expect(await getCachedValue(ctx, "my-key")).toEqual(apiSuccess(null));
		} finally {
			redis.get = originalGet;
		}
	});

	it("returns null when the key does not exist", async () => {
		const originalGet = redis.get.bind(redis);
		// oxlint-disable-next-line no-unsafe-type-assertion
		redis.get = () => Promise.resolve(null as never);
		try {
			expect(await getCachedValue(ctx, "missing-key")).toEqual(apiSuccess(null));
		} finally {
			redis.get = originalGet;
		}
	});

	it("returns failure for a blank key", async () => {
		expect(await getCachedValue(ctx, "   ")).toEqual(
			apiFailure("getCachedValue expects a non-empty key string"),
		);
	});

	it("returns failure when the context has no scriptId", async () => {
		expect(await getCachedValue({ scriptId: "   " }, "my-key")).toEqual(
			apiFailure("getCachedValue requires a non-empty scriptId in context"),
		);
	});

	it("returns failure when redis throws", async () => {
		const originalGet = redis.get.bind(redis);
		redis.get = () => {
			throw new Error("connection refused");
		};
		try {
			expect(await getCachedValue(ctx, "my-key")).toEqual(apiFailure("connection refused"));
		} finally {
			redis.get = originalGet;
		}
	});
});
