import type { WorkflowReplayJournalEntry } from "@ryot-app/plugin-backend-sdk/workflow";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Effect, Schema } from "effect";

import { appendSandboxJournal } from "#modules/scripts/replay/journal-store";
import { RedisService } from "#platform/redis";

const encodeJournalEntry = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

export const hashWorkflowCallArgs = (args: unknown) => sha256Base64Url(stableStringify(args));

export const appendWorkflowJournalWithRedis = (
	redis: Parameters<typeof appendSandboxJournal>[0],
	executionId: string,
	firstIndex: number,
	entries: ReadonlyArray<WorkflowReplayJournalEntry>,
) =>
	Effect.forEach(entries, ({ value, request }) => encodeJournalEntry({ value, request })).pipe(
		Effect.orDie,
		Effect.flatMap((texts) => appendSandboxJournal(redis, executionId, firstIndex, texts)),
	);

export const appendWorkflowJournal = (
	executionId: string,
	firstIndex: number,
	entries: ReadonlyArray<WorkflowReplayJournalEntry>,
) =>
	Effect.flatMap(RedisService, (redis) =>
		appendWorkflowJournalWithRedis(redis, executionId, firstIndex, entries),
	);
