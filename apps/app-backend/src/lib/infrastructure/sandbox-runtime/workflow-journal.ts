import { hostFailure, hostSuccess } from "@ryot/sandbox-sdk/wire";
import {
	type WorkflowReplayJournalEntry as WorkflowJournalEntry,
	workflowReplayJournalEntrySchema,
} from "@ryot/sandbox-sdk/workflow";
import { sha256Base64Url } from "@ryot/ts-utils/crypto";
import { stableStringify } from "@ryot/ts-utils/json";
import { Effect, Schema } from "effect";

import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import {
	utf8ByteLength,
	WORKFLOW_SANDBOX_LIMITS,
} from "#lib/infrastructure/sandbox-runtime/limits";
import { type BoundHostFunction, isJsonValue } from "#lib/infrastructure/sandbox-runtime/shared";

const projectionTtlSeconds = 24 * 60 * 60;
const highWaterField = "high-water";

export type { WorkflowJournalEntry };

type WorkflowJournalBridgeRedis = {
	readonly client: {
		hget: (key: string, field: string) => Promise<string | null>;
		hmget: (key: string, ...fields: string[]) => Promise<Array<string | null>>;
	};
};

type WorkflowJournalProjectionRedis = {
	readonly client: {
		expire: (key: string, seconds: number) => Promise<unknown>;
		hget: (key: string, field: string) => Promise<string | null>;
		hmget: (key: string, ...fields: string[]) => Promise<Array<string | null>>;
		pipeline: () => {
			exec: () => Promise<unknown>;
			hset: (key: string, field: string, value: string) => unknown;
			expire: (key: string, seconds: number) => unknown;
		};
	};
};

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeJournalEntry = Schema.decodeUnknownResult(
	Schema.fromJsonString(workflowReplayJournalEntrySchema),
);
const decodeBootstrapArgs = Schema.decodeUnknownResult(Schema.Tuple([]));

export const hashWorkflowCallArgs = (args: unknown) => sha256Base64Url(stableStringify(args));

export const projectWorkflowJournalWithRedis = (
	redis: WorkflowJournalProjectionRedis,
	executionId: string,
	journal: ReadonlyArray<WorkflowJournalEntry>,
) =>
	Effect.gen(function* () {
		const key = redisKeys.sandboxWorkflowJournal(executionId);
		const rawHighWater = yield* Effect.tryPromise(() => redis.client.hget(key, highWaterField));
		const highWater = rawHighWater === null ? 0 : Number(rawHighWater);
		const encodedEntries = journal.map(({ request, value }) => encodeJson({ request, value }));
		const fields = encodedEntries.map((_, index) => String(index));
		const projectedEntries =
			fields.length === 0 ? [] : yield* Effect.tryPromise(() => redis.client.hmget(key, ...fields));
		const projectionMatches =
			Number.isSafeInteger(highWater) &&
			highWater === journal.length &&
			projectedEntries.every((entry, index) => entry === encodedEntries[index]);
		if (projectionMatches) {
			yield* Effect.tryPromise(() => redis.client.expire(key, projectionTtlSeconds));
			return;
		}

		const pipeline = redis.client.pipeline();
		encodedEntries.forEach((entry, index) => {
			if (projectedEntries[index] !== entry) {
				pipeline.hset(key, String(index), entry);
			}
		});
		pipeline.hset(key, highWaterField, String(journal.length));
		pipeline.expire(key, projectionTtlSeconds);
		yield* Effect.tryPromise(() => pipeline.exec());
	}).pipe(Effect.orDie);

export const projectWorkflowJournal = (
	executionId: string,
	journal: ReadonlyArray<WorkflowJournalEntry>,
) =>
	Effect.gen(function* () {
		const redis = yield* RedisService;
		yield* projectWorkflowJournalWithRedis(redis, executionId, journal);
	});

export const makeWorkflowDurableCallsHostFunction =
	(workflowExecutionId: string | undefined, redis: WorkflowJournalBridgeRedis) =>
	(args: Parameters<BoundHostFunction>[0]) =>
		Effect.gen(function* () {
			const decoded = decodeBootstrapArgs(args);
			if (decoded._tag === "Failure") {
				return hostFailure("durableCalls does not accept arguments");
			}
			if (!workflowExecutionId) {
				return hostFailure("durableCalls is available only to workflow executions");
			}
			const key = redisKeys.sandboxWorkflowJournal(workflowExecutionId);
			const rawHighWater = yield* Effect.promise(() => redis.client.hget(key, highWaterField));
			const highWater = rawHighWater === null ? 0 : Number(rawHighWater);
			if (
				!Number.isSafeInteger(highWater) ||
				highWater < 0 ||
				highWater > WORKFLOW_SANDBOX_LIMITS.hostCalls.total
			) {
				return hostFailure("Sandbox workflow journal high-water mark is corrupt");
			}
			const fields = Array.from({ length: highWater }, (_, index) => String(index));
			const rawEntries =
				fields.length === 0 ? [] : yield* Effect.promise(() => redis.client.hmget(key, ...fields));
			const entries: WorkflowJournalEntry[] = [];
			let encodedBytes = 2;
			for (let index = 0; index < rawEntries.length; index += 1) {
				const raw = rawEntries[index];
				if (raw === null || raw === undefined) {
					return hostFailure(`Sandbox workflow journal[${index}] is missing`);
				}
				encodedBytes += utf8ByteLength(raw) + (index === 0 ? 0 : 1);
				if (encodedBytes > WORKFLOW_SANDBOX_LIMITS.journalBytes) {
					return hostFailure("Sandbox workflow journal projection exceeds its byte limit");
				}

				const entry = decodeJournalEntry(raw);
				if (
					entry._tag === "Failure" ||
					entry.success.request.index !== index ||
					!isJsonValue(entry.success.value)
				) {
					return hostFailure(`Sandbox workflow journal[${index}] is corrupt`);
				}
				entries.push(entry.success);
			}

			return hostSuccess(entries);
		});
