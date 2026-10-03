import { utf8ByteLength } from "@ryot-app/sandbox-compiler/limits";
import { hostFailure, hostSuccess } from "@ryot-app/sandbox-sdk/wire";
import {
	type WorkflowReplayJournalEntry,
	workflowReplayJournalEntrySchema,
} from "@ryot-app/sandbox-sdk/workflow";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Effect, Schema } from "effect";

import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import { SANDBOX_LIMITS } from "#lib/infrastructure/sandbox-runtime/limits";
import { type BoundHostFunction, isJsonValue } from "#lib/infrastructure/sandbox-runtime/shared";

const projectionTtlSeconds = 24 * 60 * 60;
const highWaterField = "high-water";
const projectWorkflowJournalScript = `
local expectedHighWater = ARGV[1]
local entryCount = tonumber(expectedHighWater)
local projectedEntries = {}

if entryCount > 0 then
  local fields = {}
  for index = 0, entryCount - 1 do
    fields[index + 1] = tostring(index)
  end
  projectedEntries = redis.call('HMGET', KEYS[1], unpack(fields))
end

local projectionMatches = redis.call('HGET', KEYS[1], '${highWaterField}') == expectedHighWater
if projectionMatches then
  for index = 1, entryCount do
    if projectedEntries[index] ~= ARGV[index + 2] then
      projectionMatches = false
      break
    end
  end
end

if projectionMatches then
  return redis.call('EXPIRE', KEYS[1], ARGV[2])
end

local projection = {'${highWaterField}', expectedHighWater}
for index = 1, entryCount do
  projection[#projection + 1] = tostring(index - 1)
  projection[#projection + 1] = ARGV[index + 2]
end
redis.call('HSET', KEYS[1], unpack(projection))
return redis.call('EXPIRE', KEYS[1], ARGV[2])
`;

type WorkflowJournalBridgeRedis = {
	readonly client: { hgetall: (key: string) => Promise<Record<string, string>> };
};

type WorkflowJournalProjectionRedis = {
	readonly client: {
		eval: (
			script: string,
			numberOfKeys: number,
			key: string,
			...args: string[]
		) => Promise<unknown>;
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
	journal: ReadonlyArray<WorkflowReplayJournalEntry>,
) =>
	Effect.gen(function* () {
		const key = redisKeys.sandboxWorkflowJournal(executionId);
		const encodedEntries = journal.map(({ value, request }) => encodeJson({ value, request }));
		yield* Effect.tryPromise(() =>
			redis.client.eval(
				projectWorkflowJournalScript,
				1,
				key,
				String(journal.length),
				String(projectionTtlSeconds),
				...encodedEntries,
			),
		);
	}).pipe(Effect.orDie);

export const projectWorkflowJournal = (
	executionId: string,
	journal: ReadonlyArray<WorkflowReplayJournalEntry>,
) =>
	Effect.gen(function* () {
		const redis = yield* RedisService;
		yield* projectWorkflowJournalWithRedis(redis, executionId, journal);
	});

export const makeWorkflowReplayJournalHostFunction =
	(workflowExecutionId: string | undefined, redis: WorkflowJournalBridgeRedis) =>
	(args: Parameters<BoundHostFunction>[0]) =>
		Effect.gen(function* () {
			const decoded = decodeBootstrapArgs(args);
			if (decoded._tag === "Failure") {
				return hostFailure("replayJournal does not accept arguments");
			}
			if (!workflowExecutionId) {
				return hostFailure("replayJournal is available only to workflow executions");
			}
			const key = redisKeys.sandboxWorkflowJournal(workflowExecutionId);
			const fields = yield* Effect.promise(() => redis.client.hgetall(key));
			const rawHighWater = fields[highWaterField];
			const highWater = rawHighWater === undefined ? 0 : Number(rawHighWater);
			if (
				!Number.isSafeInteger(highWater) ||
				highWater < 0 ||
				highWater > SANDBOX_LIMITS.hostCalls.total
			) {
				return hostFailure("Sandbox workflow journal high-water mark is corrupt");
			}
			const entries: WorkflowReplayJournalEntry[] = [];
			let encodedBytes = 2;
			for (let index = 0; index < highWater; index += 1) {
				const raw = fields[String(index)];
				if (raw === undefined) {
					return hostFailure(`Sandbox workflow journal[${index}] is missing`);
				}
				encodedBytes += utf8ByteLength(raw) + (index === 0 ? 0 : 1);
				if (encodedBytes > SANDBOX_LIMITS.journalBytes) {
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
