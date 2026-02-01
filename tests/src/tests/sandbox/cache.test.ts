import { Effect } from "effect";

import {
	cacheSandboxSource,
	createAuthenticatedClient,
	createSandboxScript,
	enqueueSandboxScript,
	pollSandboxResult,
	requireCompletedSandboxValue,
} from "~/fixtures";
import { requireObjectRecord } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("sandbox cache functions", () => {
	it.live(
		"setCachedValue stores a value that getCachedValue retrieves within the same script",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const cacheKey = `cache-test-${crypto.randomUUID()}`;
				const slug = `cache-round-trip-${crypto.randomUUID()}`;
				const { id: scriptId } = yield* createSandboxScript(client, {
					source: cacheSandboxSource({
						slug,
						key: cacheKey,
						ttlSeconds: 60,
						value: { value: 42 },
						operation: "roundTrip",
						name: "cache-round-trip",
					}),
				});
				const { jobId } = yield* enqueueSandboxScript(client, { scriptId, driverName: "main" });

				const value = requireObjectRecord(
					requireCompletedSandboxValue(yield* pollSandboxResult(client, jobId)),
					"Expected cache write result to be an object",
				);
				expect(value.success).toBe(true);
				expect(value.data).toEqual({ value: 42 });
			}),
	);

	it.live("getCachedValue returns null for a key that was never set", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const missingKey = `cache-missing-${crypto.randomUUID()}`;
			const slug = `cache-miss-${crypto.randomUUID()}`;
			const { id: scriptId } = yield* createSandboxScript(client, {
				source: cacheSandboxSource({
					slug,
					key: missingKey,
					operation: "get",
					name: "cache-miss",
				}),
			});
			const { jobId } = yield* enqueueSandboxScript(client, { scriptId, driverName: "main" });

			const value = requireObjectRecord(
				requireCompletedSandboxValue(yield* pollSandboxResult(client, jobId)),
				"Expected cache miss result to be an object",
			);
			expect(value.success).toBe(true);
			expect(value.data).toBeNull();
		}),
	);

	it.live("cache is isolated between different scripts for the same key", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const sharedKey = `cache-isolation-${crypto.randomUUID()}`;
			const writerSlug = `cache-writer-${crypto.randomUUID()}`;
			const { id: writerScriptId } = yield* createSandboxScript(client, {
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
			const { id: readerScriptId } = yield* createSandboxScript(client, {
				source: cacheSandboxSource({
					key: sharedKey,
					slug: readerSlug,
					operation: "get",
					name: "cache-reader",
				}),
			});

			const { jobId: writeJobId } = yield* enqueueSandboxScript(client, {
				driverName: "main",
				scriptId: writerScriptId,
			});
			yield* pollSandboxResult(client, writeJobId);

			const { jobId: readJobId } = yield* enqueueSandboxScript(client, {
				driverName: "main",
				scriptId: readerScriptId,
			});
			const value = requireObjectRecord(
				requireCompletedSandboxValue(yield* pollSandboxResult(client, readJobId)),
				"Expected cache isolation read result to be an object",
			);
			expect(value.success).toBe(true);
			expect(value.data).toBeNull();
		}),
	);

	it.live("built-in scripts share a cache partition across users for the same key", () =>
		Effect.gen(function* () {
			const { client: clientA } = yield* createAuthenticatedClient();
			const { client: clientB } = yield* createAuthenticatedClient();

			const cacheKey = `builtin-shared-cache-${crypto.randomUUID()}`;

			const writerSlug = `builtin-cache-writer-${crypto.randomUUID()}`;
			const { id: writerScriptId } = yield* createSandboxScript(clientA, {
				source: cacheSandboxSource({
					key: cacheKey,
					ttlSeconds: 60,
					slug: writerSlug,
					operation: "set",
					name: "builtin-cache-writer",
					value: { sharedValue: true },
				}),
			});

			const { jobId: writeJobId } = yield* enqueueSandboxScript(clientA, {
				scriptId: writerScriptId,
				driverName: "main",
			});
			yield* pollSandboxResult(clientA, writeJobId);

			const readerSlug = `builtin-cache-reader-${crypto.randomUUID()}`;
			const { id: readerScriptId } = yield* createSandboxScript(clientB, {
				source: cacheSandboxSource({
					key: cacheKey,
					slug: readerSlug,
					operation: "get",
					name: "builtin-cache-reader",
				}),
			});

			const { jobId: readJobId } = yield* enqueueSandboxScript(clientB, {
				driverName: "main",
				scriptId: readerScriptId,
			});
			const value = requireObjectRecord(
				requireCompletedSandboxValue(yield* pollSandboxResult(clientB, readJobId)),
				"Expected cross-user cache result to be an object",
			);
			expect(value.success).toBe(true);
			expect(value.data).toBeNull();
		}),
	);
});
