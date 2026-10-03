import { expect, it, layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import {
	inspectSandboxJournal,
	pinSandboxJournal,
} from "#lib/infrastructure/sandbox-journal-store";
import { testExecutionId, testRedisServiceLayer } from "#lib/test-utils/redis";

import { selectSandboxHostFunctions } from "./service";
import type { SandboxRunInput } from "./shared";
import { appendWorkflowJournalWithRedis } from "./workflow-journal";
import { readPinnedJournal } from "./workflow-journal.test-support";

const workflowInput: SandboxRunInput = {
	context: {},
	compiledCode: "",
	compiledFormat: 1,
	workflowExecutionId: "parent",
	executionId: "parent-replay-3",
	principal: {
		contentHash: "",
		providerId: null,
		scriptSlug: "script",
		pluginRevision: null,
		subject: { type: "system" },
		scriptId: SandboxScriptId.make("workflow-script"),
		metadata: { kind: "workflow", runtimeImports: [] },
	},
};

const request = (index: number, name: string, input: JsonValue = { index }) => ({
	name,
	index,
	kind: "activity" as const,
	args: { input, scriptSlug: "activity-script" },
});

const unusedHostFunction = () => Effect.succeed(null);

const entry = (index: number, result: number) => ({
	value: { result },
	request: request(index, `call-${index}`),
});

const journalKey = (executionId: string) => redisKeys.sandboxWorkflowJournal(executionId);
const readProjectedJournal = Effect.fnUntraced(function* (
	redis: RedisService["Service"],
	executionId: string,
	length: number,
) {
	const inspection = yield* inspectSandboxJournal(redis, executionId, length);
	return inspection === null
		? null
		: yield* readPinnedJournal(pinSandboxJournal(redis, executionId, inspection));
});

layer(testRedisServiceLayer)((test) => {
	test.effect("appends write-once entries idempotently and refreshes the projection ttl", () =>
		Effect.gen(function* () {
			const redis = yield* RedisService;
			const executionId = testExecutionId("append");
			const journal = [entry(0, 1), entry(1, 2)];

			yield* appendWorkflowJournalWithRedis(redis, executionId, 0, journal);
			const projected = yield* Effect.promise(() => redis.client.hgetall(journalKey(executionId)));
			yield* Effect.promise(() => redis.client.expire(journalKey(executionId), 10));
			yield* appendWorkflowJournalWithRedis(redis, executionId, 0, journal);

			expect(new Set(Object.keys(projected))).toEqual(new Set(["c:0:0", "c:1:0", "m:0", "m:1"]));
			expect(yield* Effect.promise(() => redis.client.hgetall(journalKey(executionId)))).toEqual(
				projected,
			);
			expect(
				yield* Effect.promise(() => redis.client.ttl(journalKey(executionId))),
			).toBeGreaterThan(10);
		}),
	);

	test.effect("writes nothing for an empty suffix", () =>
		Effect.gen(function* () {
			const redis = yield* RedisService;
			const executionId = testExecutionId("empty");

			yield* appendWorkflowJournalWithRedis(redis, executionId, 0, []);

			expect(yield* Effect.promise(() => redis.client.exists(journalKey(executionId)))).toBe(0);
		}),
	);

	test.effect("keeps a longer journal when an older activation re-appends a prefix", () =>
		Effect.gen(function* () {
			const redis = yield* RedisService;
			const executionId = testExecutionId("prefix");
			const journal = [entry(0, 1), entry(1, 2), entry(2, 3)];

			yield* appendWorkflowJournalWithRedis(redis, executionId, 0, journal);
			yield* appendWorkflowJournalWithRedis(redis, executionId, 0, journal.slice(0, 2));

			expect(yield* readProjectedJournal(redis, executionId, 3)).toEqual(journal);
		}),
	);

	test.effect("surfaces a differing re-append as an infrastructure failure naming the index", () =>
		Effect.gen(function* () {
			const redis = yield* RedisService;
			const executionId = testExecutionId("diverge");

			yield* appendWorkflowJournalWithRedis(redis, executionId, 0, [entry(0, 1), entry(1, 2)]);
			const error = yield* Effect.flip(
				appendWorkflowJournalWithRedis(redis, executionId, 1, [entry(1, 99)]),
			);

			expect(error).toBeInstanceOf(SandboxRunError);
			expect(error).toMatchObject({ kind: "infrastructure" });
			expect(error.message).toContain("journal[1]");
		}),
	);

	test.effect("reads exactly the requested journal length and ignores later entries", () =>
		Effect.gen(function* () {
			const redis = yield* RedisService;
			const executionId = testExecutionId("exact");
			const journal = [entry(0, 1), entry(1, 2), entry(2, 3)];

			yield* appendWorkflowJournalWithRedis(redis, executionId, 0, journal);

			expect(yield* readProjectedJournal(redis, executionId, 2)).toEqual(journal.slice(0, 2));
		}),
	);

	test.effect("reads an empty journal that was never projected", () =>
		Effect.gen(function* () {
			const redis = yield* RedisService;

			expect(yield* readProjectedJournal(redis, testExecutionId("none"), 0)).toEqual([]);
		}),
	);

	test.effect("reports a lost entry as a missing projection", () =>
		Effect.gen(function* () {
			const redis = yield* RedisService;
			const executionId = testExecutionId("lost");

			yield* appendWorkflowJournalWithRedis(redis, executionId, 0, [entry(0, 1), entry(1, 2)]);
			expect(yield* readProjectedJournal(redis, executionId, 2)).toHaveLength(2);

			yield* Effect.promise(() => redis.client.hdel(journalKey(executionId), "m:1"));

			expect(yield* readProjectedJournal(redis, executionId, 2)).toBeNull();
			expect(yield* readProjectedJournal(redis, testExecutionId("never-written"), 1)).toBeNull();
		}),
	);
});

it("keeps workflow replay journal out of ordinary host-function selection", () => {
	const bound = { httpCall: unusedHostFunction, replayJournal: unusedHostFunction };
	expect(
		Object.keys(
			selectSandboxHostFunctions(bound, {
				principal: {
					...workflowInput.principal,
					metadata: { kind: "workflow", runtimeImports: [], capabilities: ["httpCall"] },
				},
			}),
		),
	).toEqual([]);
	expect(
		Object.keys(
			selectSandboxHostFunctions(bound, {
				principal: {
					...workflowInput.principal,
					metadata: { kind: "script", runtimeImports: [], capabilities: ["replayJournal"] },
				},
			}),
		),
	).toEqual([]);
	expect(
		Object.keys(
			selectSandboxHostFunctions(bound, {
				principal: {
					...workflowInput.principal,
					metadata: {
						kind: "script",
						runtimeImports: [],
						capabilities: ["httpCall", "replayJournal"],
					},
				},
			}),
		),
	).toEqual(["httpCall"]);
});
