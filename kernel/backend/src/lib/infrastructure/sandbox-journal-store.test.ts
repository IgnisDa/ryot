import { assert, expect, layer } from "@effect/vitest";
import { utf8ByteLength } from "@ryot-app/sandbox-compiler/limits";
import { Effect, Schema } from "effect";

import { testExecutionId, testRedisServiceLayer } from "#lib/test-utils/redis";

import { redisKeys, RedisService } from "./redis";
import { inspectSandboxJournal, readEncodedSandboxJournal } from "./sandbox-journal-store";
import { SANDBOX_LIMITS } from "./sandbox-runtime/limits";
import {
	appendWorkflowJournalWithRedis,
	readWorkflowJournal,
} from "./sandbox-runtime/workflow-journal";

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
			expect(inspection.entries).toHaveLength(2);
			expect(inspection.entries.map(([bytes]) => bytes)).toEqual(
				journal.slice(0, 2).map((value) => utf8ByteLength(encodeJson(value))),
			);
			expect(yield* readWorkflowJournal(redis, executionId, inspection)).toEqual(
				journal.slice(0, 2),
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
					redis.client.eval(
						"redis.call('HSET', KEYS[1], '0', string.rep('x', tonumber(ARGV[1]))); return 1",
						1,
						key,
						String(SANDBOX_LIMITS.journalBytes),
					),
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

	test.effect("journal_reads_reject_changed_inspected_prefix", () =>
		Effect.gen(function* () {
			const redis = yield* RedisService;
			for (const replacement of ["different", "a much larger replacement"]) {
				const executionId = testExecutionId("changed-prefix");
				const key = redisKeys.sandboxWorkflowJournal(executionId);
				yield* appendWorkflowJournalWithRedis(redis, executionId, 0, [entry(0, "original!")]);
				const inspection = yield* inspectSandboxJournal(redis, executionId, 1);
				assert(inspection !== null);
				yield* Effect.promise(() => redis.client.hset(key, "0", encodeJson(entry(0, replacement))));

				const error = yield* Effect.flip(readEncodedSandboxJournal(redis, executionId, inspection));
				expect(error.kind).toBe("infrastructure");
				expect(error.message).toBe("Sandbox workflow journal changed after inspection");
			}
		}),
	);

	test.effect("journal_inspection_preserves_missing_prefix_and_immutable_appends", () =>
		Effect.gen(function* () {
			const redis = yield* RedisService;
			const executionId = testExecutionId("inspect-append");
			const journal = [entry(0, "first"), entry(1, "second")];
			yield* appendWorkflowJournalWithRedis(redis, executionId, 0, journal.slice(0, 1));
			const inspection = yield* inspectSandboxJournal(redis, executionId, 1);
			assert(inspection !== null);
			yield* appendWorkflowJournalWithRedis(redis, executionId, 1, journal.slice(1));
			expect(yield* readWorkflowJournal(redis, executionId, inspection)).toEqual(
				journal.slice(0, 1),
			);

			yield* Effect.promise(() =>
				redis.client.hdel(redisKeys.sandboxWorkflowJournal(executionId), "0"),
			);
			expect(yield* readEncodedSandboxJournal(redis, executionId, inspection)).toBeNull();
			expect(yield* inspectSandboxJournal(redis, executionId, 2)).toBeNull();
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
