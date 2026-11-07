import type { WorkflowReplayJournalEntry } from "@ryot-app/plugin-backend-sdk/workflow";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Effect, Schema } from "effect";

import { appendSandboxJournal } from "#modules/scripts/replay/journal-store";
import { DatabaseSession } from "#platform/db/session";

const encodeJournalEntry = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

export const hashWorkflowCallArgs = (args: unknown) => sha256Base64Url(stableStringify(args));

export const appendWorkflowJournal = (
	executionId: string,
	firstIndex: number,
	entries: ReadonlyArray<WorkflowReplayJournalEntry>,
) =>
	Effect.forEach(entries, ({ value, request }) => encodeJournalEntry({ value, request })).pipe(
		Effect.orDie,
		Effect.flatMap((texts) =>
			Effect.flatMap(DatabaseSession, (session) =>
				appendSandboxJournal(session, executionId, firstIndex, texts),
			),
		),
	);
