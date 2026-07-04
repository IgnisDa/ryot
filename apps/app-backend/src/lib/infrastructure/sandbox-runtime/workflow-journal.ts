import type { JsonValue } from "@ryot/sandbox-sdk/wire";
import type { WorkflowDurableCallRequest } from "@ryot/sandbox-sdk/workflow";
import { sha256Base64Url } from "@ryot/ts-utils/crypto";
import { stableStringify } from "@ryot/ts-utils/json";
import { Effect, Schema } from "effect";

import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import {
	apiFailure,
	apiSuccess,
	type BoundHostFunction,
	isJsonValue,
} from "#lib/infrastructure/sandbox-runtime/shared";

const projectionTtlSeconds = 24 * 60 * 60;
const highWaterField = "high-water";

const JournalEntry = Schema.Struct({
	name: Schema.String,
	value: Schema.Unknown,
	argsHash: Schema.String,
	kind: Schema.Literals(["activity", "sleep", "child"]),
});

export type WorkflowJournalEntry = {
	readonly value: JsonValue;
	readonly request: WorkflowDurableCallRequest;
};

type WorkflowJournalBridgeRedis = {
	readonly client: {
		hget: (key: string, field: string) => Promise<string | null>;
		hmget: (key: string, ...fields: string[]) => Promise<Array<string | null>>;
	};
};

type WorkflowJournalProjectionRedis = {
	readonly client: {
		hget: (key: string, field: string) => Promise<string | null>;
		expire: (key: string, seconds: number) => Promise<unknown>;
		pipeline: () => {
			exec: () => Promise<unknown>;
			hset: (key: string, field: string, value: string) => unknown;
			expire: (key: string, seconds: number) => unknown;
			hsetnx: (key: string, field: string, value: string) => unknown;
		};
	};
};

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeJournalEntry = Schema.decodeUnknownResult(Schema.fromJsonString(JournalEntry));
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
		if (Number.isSafeInteger(highWater) && highWater === journal.length) {
			yield* Effect.tryPromise(() => redis.client.expire(key, projectionTtlSeconds));
			return;
		}

		const pipeline = redis.client.pipeline();
		journal.forEach(({ request, value }, index) => {
			pipeline.hsetnx(
				key,
				String(index),
				encodeJson({
					value,
					kind: request.kind,
					name: request.name,
					argsHash: hashWorkflowCallArgs(request.args),
				}),
			);
		});
		// Each body pass rebuilds the visible prefix from zero; entries remain immutable via HSETNX.
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
				return apiFailure("durableCalls does not accept arguments");
			}
			if (!workflowExecutionId) {
				return apiFailure("durableCalls is available only to workflow executions");
			}
			const key = redisKeys.sandboxWorkflowJournal(workflowExecutionId);
			const rawHighWater = yield* Effect.promise(() => redis.client.hget(key, highWaterField));
			const highWater = rawHighWater === null ? 0 : Number(rawHighWater);
			if (!Number.isSafeInteger(highWater) || highWater < 0) {
				return apiFailure("Sandbox workflow journal high-water mark is corrupt");
			}
			const fields = Array.from({ length: highWater }, (_, index) => String(index));
			const rawEntries =
				fields.length === 0 ? [] : yield* Effect.promise(() => redis.client.hmget(key, ...fields));
			const values: JsonValue[] = [];
			for (let index = 0; index < rawEntries.length; index += 1) {
				const raw = rawEntries[index];
				if (raw === null || raw === undefined) {
					return apiFailure(`Sandbox workflow journal[${index}] is missing`);
				}

				const entry = decodeJournalEntry(raw);
				if (entry._tag === "Failure" || !isJsonValue(entry.success.value)) {
					return apiFailure(`Sandbox workflow journal[${index}] is corrupt`);
				}
				values.push(entry.success.value);
			}

			return apiSuccess(values);
		});
