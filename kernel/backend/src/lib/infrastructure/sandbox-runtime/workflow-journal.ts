import type { WorkflowReplayJournalEntry } from "@ryot-app/sandbox-sdk/workflow";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Effect, Schema } from "effect";

import { RedisService } from "#lib/infrastructure/redis";
import { appendSandboxJournal } from "#lib/infrastructure/sandbox-journal-store";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

export const hashWorkflowCallArgs = (args: unknown) => sha256Base64Url(stableStringify(args));

export const appendWorkflowJournalWithRedis = (
	redis: Parameters<typeof appendSandboxJournal>[0],
	executionId: string,
	firstIndex: number,
	entries: ReadonlyArray<WorkflowReplayJournalEntry>,
) =>
	appendSandboxJournal(
		redis,
		executionId,
		firstIndex,
		entries.map(({ value, request }) => encodeJson({ value, request })),
	);

export const appendWorkflowJournal = (
	executionId: string,
	firstIndex: number,
	entries: ReadonlyArray<WorkflowReplayJournalEntry>,
) =>
	Effect.flatMap(RedisService, (redis) =>
		appendWorkflowJournalWithRedis(redis, executionId, firstIndex, entries),
	);
