import { SandboxRunError, unknownToMessage } from "@ryot-app/contract/errors";
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
import {
	readEncodedSandboxJournal,
	type SandboxJournalInspection,
} from "#lib/infrastructure/sandbox-journal-store";
import { type BoundHostFunction, isJsonValue } from "#lib/infrastructure/sandbox-runtime/shared";

const projectionTtlSeconds = 24 * 60 * 60;
const appendWorkflowJournalScript = `
local firstIndex = tonumber(ARGV[2])
for offset = 3, #ARGV do
  local field = tostring(firstIndex + offset - 3)
  local existing = redis.call('HGET', KEYS[1], field)
  if existing == false then
    redis.call('HSET', KEYS[1], field, ARGV[offset])
  elseif existing ~= ARGV[offset] then
    return redis.error_reply('journal-divergence:' .. field)
  end
end
return redis.call('EXPIRE', KEYS[1], ARGV[1])
`;
const divergencePattern = /journal-divergence:(\d+)/;

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

export const appendWorkflowJournalWithRedis = (
	redis: WorkflowJournalProjectionRedis,
	executionId: string,
	firstIndex: number,
	entries: ReadonlyArray<WorkflowReplayJournalEntry>,
) =>
	Effect.gen(function* () {
		if (entries.length === 0) {
			return;
		}
		yield* Effect.tryPromise({
			catch: unknownToMessage,
			try: () =>
				redis.client.eval(
					appendWorkflowJournalScript,
					1,
					redisKeys.sandboxWorkflowJournal(executionId),
					String(projectionTtlSeconds),
					String(firstIndex),
					...entries.map(({ value, request }) => encodeJson({ value, request })),
				),
		}).pipe(
			Effect.catch((message) => {
				const divergence = divergencePattern.exec(message);
				return divergence
					? Effect.fail(
							new SandboxRunError({
								kind: "infrastructure",
								message: `Sandbox workflow journal[${divergence[1]}] diverged from its projected entry`,
							}),
						)
					: Effect.die(message);
			}),
		);
	});

export const appendWorkflowJournal = (
	executionId: string,
	firstIndex: number,
	entries: ReadonlyArray<WorkflowReplayJournalEntry>,
) =>
	Effect.flatMap(RedisService, (redis) =>
		appendWorkflowJournalWithRedis(redis, executionId, firstIndex, entries),
	);

const journalFailure = (message: string) =>
	new SandboxRunError({ message, kind: "infrastructure" });

// ioredis cannot abort an in-flight command; its reply must remain reserved through cancellation.
export const readWorkflowJournal = (
	redis: Parameters<typeof readEncodedSandboxJournal>[0],
	executionId: string,
	inspection: SandboxJournalInspection,
) =>
	Effect.gen(function* () {
		const fields = yield* readEncodedSandboxJournal(redis, executionId, inspection);
		if (fields === null) {
			return null;
		}
		const entries: WorkflowReplayJournalEntry[] = [];
		let encodedBytes = 2;
		for (const [index, raw] of fields.entries()) {
			encodedBytes += utf8ByteLength(raw) + (index === 0 ? 0 : 1);
			if (encodedBytes > inspection.bytes) {
				return yield* journalFailure("Sandbox workflow journal exceeds its inspected reservation");
			}
			const entry = decodeJournalEntry(raw);
			if (
				entry._tag === "Failure" ||
				entry.success.request.index !== index ||
				!isJsonValue(entry.success.value)
			) {
				return yield* journalFailure(`Sandbox workflow journal[${index}] is corrupt`);
			}
			entries.push(entry.success);
		}
		return entries;
	}).pipe(Effect.uninterruptible);

export const makeWorkflowReplayJournalHostFunction =
	(journal: ReadonlyArray<WorkflowReplayJournalEntry> | undefined) =>
	(args: Parameters<BoundHostFunction>[0]) =>
		Effect.sync(() => {
			if (decodeBootstrapArgs(args)._tag === "Failure") {
				return hostFailure("replayJournal does not accept arguments");
			}
			if (!journal) {
				return hostFailure("replayJournal is available only to workflow executions");
			}
			return hostSuccess(journal);
		});
