import { Effect } from "effect";

import {
	cacheSandboxSource,
	createAuthenticatedClient,
	enqueueSandboxScript,
	installSandboxScriptScoped,
	pollSandboxResult,
	requireCompletedSandboxValue,
} from "~/fixtures";
import { requireObjectRecord } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("sandbox cache functions", () => {
	it.scopedLive(
		"setCachedValue stores a value that getCachedValue retrieves within the same script",
		() =>
			Effect.gen(function* () {
				const { userId } = yield* createAuthenticatedClient();
				const cacheKey = `cache-test-${crypto.randomUUID()}`;
				const slug = `cache-round-trip-${crypto.randomUUID()}`;
				const { scriptId } = yield* installSandboxScriptScoped({
					slug,
					name: "cache-round-trip",
					capabilities: ["setCachedValue", "getCachedValue"],
					source: cacheSandboxSource({
						slug,
						key: cacheKey,
						ttlSeconds: 60,
						value: { value: 42 },
						operation: "roundTrip",
						name: "cache-round-trip",
					}),
				});
				const { jobId } = yield* enqueueSandboxScript(userId, { scriptId, driverName: "main" });

				const value = requireObjectRecord(
					requireCompletedSandboxValue(yield* pollSandboxResult(userId, jobId)),
					"Expected cache write result to be an object",
				);
				expect(value.success).toBe(true);
				expect(value.data).toEqual({ value: 42 });
			}),
	);

	it.scopedLive("getCachedValue returns null for a key that was never set", () =>
		Effect.gen(function* () {
			const { userId } = yield* createAuthenticatedClient();
			const missingKey = `cache-missing-${crypto.randomUUID()}`;
			const slug = `cache-miss-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				name: "cache-miss",
				capabilities: ["getCachedValue"],
				source: cacheSandboxSource({ slug, key: missingKey, operation: "get", name: "cache-miss" }),
			});
			const { jobId } = yield* enqueueSandboxScript(userId, { scriptId, driverName: "main" });

			const value = requireObjectRecord(
				requireCompletedSandboxValue(yield* pollSandboxResult(userId, jobId)),
				"Expected cache miss result to be an object",
			);
			expect(value.success).toBe(true);
			expect(value.data).toBeNull();
		}),
	);

	it.scopedLive("cache is isolated between different scripts for the same key", () =>
		Effect.gen(function* () {
			const { userId } = yield* createAuthenticatedClient();
			const sharedKey = `cache-isolation-${crypto.randomUUID()}`;
			const writerSlug = `cache-writer-${crypto.randomUUID()}`;
			const { scriptId: writerScriptId } = yield* installSandboxScriptScoped({
				slug: writerSlug,
				name: "cache-writer",
				capabilities: ["setCachedValue"],
				source: cacheSandboxSource({
					key: sharedKey,
					ttlSeconds: 60,
					slug: writerSlug,
					operation: "set",
					name: "cache-writer",
					value: { secret: true },
				}),
			});
			const readerSlug = `cache-reader-${crypto.randomUUID()}`;
			const { scriptId: readerScriptId } = yield* installSandboxScriptScoped({
				slug: readerSlug,
				name: "cache-reader",
				capabilities: ["getCachedValue"],
				source: cacheSandboxSource({
					key: sharedKey,
					slug: readerSlug,
					operation: "get",
					name: "cache-reader",
				}),
			});

			const { jobId: writeJobId } = yield* enqueueSandboxScript(userId, {
				driverName: "main",
				scriptId: writerScriptId,
			});
			yield* pollSandboxResult(userId, writeJobId);

			const { jobId: readJobId } = yield* enqueueSandboxScript(userId, {
				driverName: "main",
				scriptId: readerScriptId,
			});
			const value = requireObjectRecord(
				requireCompletedSandboxValue(yield* pollSandboxResult(userId, readJobId)),
				"Expected cache isolation read result to be an object",
			);
			expect(value.success).toBe(true);
			expect(value.data).toBeNull();
		}),
	);

	it.scopedLive("cache is isolated per executing user for the same script and key", () =>
		Effect.gen(function* () {
			const { userId: userIdA } = yield* createAuthenticatedClient();
			const { userId: userIdB } = yield* createAuthenticatedClient();
			const cacheKey = `executing-user-cache-${crypto.randomUUID()}`;
			const slug = `executing-user-cache-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				name: "executing-user-cache",
				capabilities: ["setCachedValue", "getCachedValue"],
				source: cacheSandboxSource({
					slug,
					key: cacheKey,
					operation: "byInput",
					name: "executing-user-cache",
					value: { privateValue: true },
				}),
			});

			const { jobId: writeJobId } = yield* enqueueSandboxScript(userIdA, {
				scriptId,
				driverName: "main",
				context: { operation: "set" },
			});
			expect(
				requireObjectRecord(
					requireCompletedSandboxValue(yield* pollSandboxResult(userIdA, writeJobId)),
					"Expected cache write result to be an object",
				).data,
			).toEqual({ privateValue: true });

			const { jobId: otherReadJobId } = yield* enqueueSandboxScript(userIdB, {
				scriptId,
				driverName: "main",
				context: { operation: "get" },
			});
			const otherValue = requireObjectRecord(
				requireCompletedSandboxValue(yield* pollSandboxResult(userIdB, otherReadJobId)),
				"Expected cross-user cache result to be an object",
			);
			expect(otherValue.success).toBe(true);
			expect(otherValue.data).toBeNull();

			const { jobId: ownerReadJobId } = yield* enqueueSandboxScript(userIdA, {
				scriptId,
				driverName: "main",
				context: { operation: "get" },
			});
			const ownerValue = requireObjectRecord(
				requireCompletedSandboxValue(yield* pollSandboxResult(userIdA, ownerReadJobId)),
				"Expected owner cache result to be an object",
			);
			expect(ownerValue.success).toBe(true);
			expect(ownerValue.data).toEqual({ privateValue: true });
		}),
	);
});
