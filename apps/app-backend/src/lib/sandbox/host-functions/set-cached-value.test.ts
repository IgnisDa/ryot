import { describe, expect, it } from "bun:test";
import { redis } from "~/lib/redis";
import { apiFailure, apiSuccess } from "~/lib/sandbox/types";
import { setCachedValue } from "./set-cached-value";

const ctx = { scriptId: "test-script" };

describe("setCachedValue", () => {
	it("stores the value namespaced by scriptId with the given expiry", async () => {
		let capturedKey: string | undefined;
		let capturedValue: string | undefined;
		let capturedExpiry: number | undefined;
		const originalSetex = redis.setex.bind(redis);

		redis.setex = (async (key: string, expiry: number, value: string) => {
			capturedKey = key;
			capturedValue = value;
			capturedExpiry = expiry;
			return "OK";
		}) as never;

		try {
			const result = await setCachedValue(
				ctx,
				"my-key",
				{ hello: "world" },
				60,
			);
			expect(result).toEqual(apiSuccess(null));
			expect(capturedKey).toBe("sandbox:cache:test-script:my-key");
			expect(capturedExpiry).toBe(60);
			expect(JSON.parse(capturedValue ?? "null")).toEqual({ hello: "world" });
		} finally {
			redis.setex = originalSetex;
		}
	});

	it("trims whitespace from the key before storing", async () => {
		const originalSetex = redis.setex.bind(redis);
		let capturedKey: string | undefined;

		redis.setex = (async (key: string) => {
			capturedKey = key;
			return "OK";
		}) as never;

		try {
			await setCachedValue(ctx, "  trimmed-key  ", "value", 30);
			expect(capturedKey).toBe("sandbox:cache:test-script:trimmed-key");
		} finally {
			redis.setex = originalSetex;
		}
	});

	it("returns failure for a blank key", async () => {
		expect(await setCachedValue(ctx, "   ", "value", 60)).toEqual(
			apiFailure("setCachedValue expects a non-empty key string"),
		);
	});

	it("returns failure when the context has no scriptId", async () => {
		expect(
			await setCachedValue({ scriptId: "   " }, "key", "value", 60),
		).toEqual(
			apiFailure("setCachedValue requires a non-empty scriptId in context"),
		);
	});

	it("returns failure for a zero expiry", async () => {
		expect(await setCachedValue(ctx, "key", "value", 0)).toEqual(
			apiFailure("setCachedValue expects a positive integer expiry in seconds"),
		);
	});

	it("returns failure for a negative expiry", async () => {
		expect(await setCachedValue(ctx, "key", "value", -10)).toEqual(
			apiFailure("setCachedValue expects a positive integer expiry in seconds"),
		);
	});

	it("returns failure for a fractional expiry", async () => {
		expect(await setCachedValue(ctx, "key", "value", 1.5)).toEqual(
			apiFailure("setCachedValue expects a positive integer expiry in seconds"),
		);
	});

	it("returns failure for a non-serializable value", async () => {
		expect(await setCachedValue(ctx, "key", undefined, 60)).toEqual(
			apiFailure("setCachedValue value must be JSON-serializable"),
		);
	});

	it("returns failure for a circular reference value", async () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		expect(await setCachedValue(ctx, "key", circular, 60)).toEqual(
			apiFailure("setCachedValue value must be JSON-serializable"),
		);
	});

	it("returns failure when redis throws", async () => {
		const originalSetex = redis.setex.bind(redis);
		redis.setex = async () => {
			throw new Error("write failed");
		};
		try {
			expect(await setCachedValue(ctx, "key", "value", 60)).toEqual(
				apiFailure("write failed"),
			);
		} finally {
			redis.setex = originalSetex;
		}
	});
});
