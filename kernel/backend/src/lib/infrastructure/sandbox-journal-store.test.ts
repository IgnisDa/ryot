import { assert, expect, layer } from "@effect/vitest";
import { utf8ByteLength } from "@ryot-app/sandbox-compiler/limits";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Deferred, Effect, Fiber, Schema } from "effect";

import { testExecutionId, testRedisServiceLayer } from "#lib/test-utils/redis";

import { redisKeys, RedisService } from "./redis";
import {
	inspectSandboxJournal,
	pinSandboxJournal,
	SANDBOX_JOURNAL_CHUNK_BYTES,
} from "./sandbox-journal-store";
import { MiB, SANDBOX_LIMITS } from "./sandbox-runtime/limits";
import { appendWorkflowJournalWithRedis } from "./sandbox-runtime/workflow-journal";
import { readPinnedJournal } from "./sandbox-runtime/workflow-journal.test-support";

const entry = (index: number, value: string) => ({
	value,
	request: {
		index,
		name: `call-${index}`,
		kind: "activity" as const,
		args: { input: null, scriptSlug: "activity" },
	},
});
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

layer(testRedisServiceLayer)((test) => {
	test.effect("journal_inspection_pins_exact_prefix_bytes_without_returning_values", () =>
		Effect.gen(function* () {
			const redis = yield* RedisService;
			const executionId = testExecutionId("inspect-prefix");
			const journal = [entry(0, "日本語 🎵"), entry(1, "second"), entry(2, "later")];
			yield* appendWorkflowJournalWithRedis(redis, executionId, 0, journal);

			const inspection = yield* inspectSandboxJournal(redis, executionId, 2);
			assert(inspection !== null);
			expect(inspection.bytes).toBe(utf8ByteLength(encodeJson(journal.slice(0, 2))));
			expect(inspection.entries).toEqual(
				journal.slice(0, 2).map((value) => {
					const text = encodeJson(value);
					return [utf8ByteLength(text), 1, sha256Hex(text)];
				}),
			);
			expect(yield* inspectSandboxJournal(redis, executionId, 0)).toEqual({
				bytes: 2,
				entries: [],
			});
		}),
	);

	test.effect("journal_inspection_bounds_reply_before_loading_values", () =>
		Effect.gen(function* () {
			const redis = yield* RedisService;
			const executionId = testExecutionId("oversized-inspection");
			const key = redisKeys.sandboxWorkflowJournal(executionId);
			yield* Effect.acquireUseRelease(
				Effect.promise(() =>
					redis.client.hset(key, "m:0", `${SANDBOX_LIMITS.journalBytes}:100:${"0".repeat(64)}`),
				),
				() =>
					Effect.gen(function* () {
						const error = yield* Effect.flip(inspectSandboxJournal(redis, executionId, 1));
						expect(error.kind).toBe("infrastructure");
						expect(error.message).toBe(
							"Sandbox workflow journal projection exceeds its byte limit",
						);
						expect(yield* inspectSandboxJournal(redis, executionId, 2)).toBeNull();
					}),
				() => Effect.promise(() => redis.client.del(key)),
			);
		}),
	);

	test.effect("lazy_journal_reads_serve_pinned_chunks_without_backend_prefix", () =>
		Effect.gen(function* () {
			const redis = yield* RedisService;
			const executionId = testExecutionId("chunked");
			const key = redisKeys.sandboxWorkflowJournal(executionId);
			const large = entry(1, `${"x".repeat(MiB - 40)}${"日本語".repeat(500_000)}`);
			const journal = [entry(0, "small"), large];
			yield* appendWorkflowJournalWithRedis(redis, executionId, 0, journal);
			const inspection = yield* inspectSandboxJournal(redis, executionId, 2);
			assert(inspection !== null);
			const largeBytes = utf8ByteLength(encodeJson(large));
			const largeChunks = Math.ceil(largeBytes / SANDBOX_JOURNAL_CHUNK_BYTES);
			expect(largeChunks).toBeGreaterThan(2);
			expect(inspection.entries[1]?.slice(0, 2)).toEqual([largeBytes, largeChunks]);

			yield* appendWorkflowJournalWithRedis(redis, executionId, 2, [entry(2, "suffix")]);
			const pinned = pinSandboxJournal(redis, executionId, inspection);
			expect(yield* readPinnedJournal(pinned)).toEqual(journal);
			const lastChunk = yield* pinned.readChunk(1, largeChunks - 1);
			expect(lastChunk?.byteLength).toBe(
				largeBytes - (largeChunks - 1) * SANDBOX_JOURNAL_CHUNK_BYTES,
			);
			expect(yield* pinned.readChunk(2, 0)).toBeNull();
			expect(pinned.fault()).toBe("failed");

			yield* Effect.promise(() => redis.client.hset(key, "c:1:1", "short"));
			const changedChunk = pinSandboxJournal(redis, executionId, inspection);
			expect(yield* changedChunk.readChunk(0, 0)).not.toBeNull();
			expect(yield* changedChunk.readChunk(1, 1)).toBeNull();
			expect(changedChunk.fault()).toBe("changed");

			yield* Effect.promise(() => redis.client.hset(key, "m:0", `1:1:${"0".repeat(64)}`));
			const changedMeta = pinSandboxJournal(redis, executionId, inspection);
			expect(yield* changedMeta.readChunk(0, 0)).toBeNull();
			expect(changedMeta.fault()).toBe("changed");

			yield* Effect.promise(() => redis.client.hdel(key, "c:1:2"));
			const missing = pinSandboxJournal(redis, executionId, inspection);
			expect(yield* missing.readChunk(1, 2)).toBeNull();
			expect(missing.fault()).toBe("missing");
			expect(yield* missing.readChunk(1, 0)).toBeNull();
			expect(missing.fault()).toBe("missing");
		}),
	);

	test.effect("journal_chunk_reads_hold_cancellation_until_the_reply_lands", () =>
		Effect.gen(function* () {
			const started = yield* Deferred.make<void>();
			const pending = Promise.withResolvers<unknown>();
			const pinned = pinSandboxJournal(
				{
					client: {
						eval: () => Promise.reject(new Error("unused")),
						callBuffer: () => {
							Deferred.doneUnsafe(started, Effect.void);
							return pending.promise;
						},
					},
				},
				"cancelled-chunk-read",
				{ bytes: 3, entries: [[1, 1, "0".repeat(64)]] },
			);
			const reader = yield* pinned.readChunk(0, 0).pipe(Effect.forkChild);
			yield* Deferred.await(started);
			const cancelling = yield* Fiber.interrupt(reader).pipe(Effect.forkChild);
			yield* Effect.yieldNow;
			expect(cancelling.pollUnsafe()).toBeUndefined();
			pending.resolve(Buffer.from("x"));
			yield* Fiber.join(cancelling);
		}),
	);

	test.effect("journal_projection_rejects_divergent_chunk_appends", () =>
		Effect.gen(function* () {
			const redis = yield* RedisService;
			const executionId = testExecutionId("divergent");
			const key = redisKeys.sandboxWorkflowJournal(executionId);
			const original = entry(0, "o".repeat(MiB + 1));
			yield* appendWorkflowJournalWithRedis(redis, executionId, 0, [original]);
			yield* appendWorkflowJournalWithRedis(redis, executionId, 2, [entry(2, "projected")]);
			const projected = yield* Effect.promise(() => redis.client.hgetallBuffer(key));
			yield* appendWorkflowJournalWithRedis(redis, executionId, 0, [original]);

			const error = yield* Effect.flip(
				appendWorkflowJournalWithRedis(redis, executionId, 0, [
					original,
					entry(1, "new"),
					entry(2, "different"),
				]),
			);
			expect(error.message).toBe("Sandbox workflow journal[2] diverged from its projected entry");
			const conflicting = yield* Effect.flip(
				appendWorkflowJournalWithRedis(redis, executionId, 0, [
					entry(0, "o".repeat(MiB + 1).replace(/o$/, "p")),
				]),
			);
			expect(conflicting.message).toBe(
				"Sandbox workflow journal[0] diverged from its projected entry",
			);
			expect(yield* Effect.promise(() => redis.client.hgetallBuffer(key))).toEqual(projected);
		}),
	);

	test.effect("journal_inspection_rejects_invalid_lengths_and_unavailable_state", () =>
		Effect.gen(function* () {
			const redis = yield* RedisService;
			const executionId = testExecutionId("invalid-inspection");
			for (const length of [-1, 0.5, Number.NaN, SANDBOX_LIMITS.hostCalls.total + 1]) {
				const error = yield* Effect.flip(inspectSandboxJournal(redis, executionId, length));
				expect(error.message).toBe("Sandbox workflow journal length is invalid");
			}
			yield* Effect.promise(() =>
				redis.client.set(redisKeys.sandboxWorkflowJournal(executionId), "not-a-journal", "EX", 60),
			);
			const error = yield* Effect.flip(inspectSandboxJournal(redis, executionId, 1));
			expect(error.kind).toBe("infrastructure");
			expect(error.message).toContain("Sandbox workflow journal command failed");
		}),
	);
});
