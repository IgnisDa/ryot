import {
	type WorkflowReplayJournalEntry,
	workflowReplayJournalEntrySchema,
} from "@ryot-app/sandbox-sdk/workflow";
import { Effect, Schema } from "effect";

import {
	chunkSandboxJournalEntry,
	SANDBOX_JOURNAL_CHUNK_BYTES,
	type SandboxPinnedJournal,
} from "#lib/infrastructure/sandbox-journal-store";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeEntry = Schema.decodeUnknownSync(
	Schema.fromJsonString(workflowReplayJournalEntrySchema),
);

export const memoryPinnedJournal = (
	entries: ReadonlyArray<WorkflowReplayJournalEntry>,
): SandboxPinnedJournal => {
	const encoded = entries.map(({ value, request }) =>
		chunkSandboxJournalEntry(encodeJson({ value, request })),
	);
	return {
		fault: () => undefined,
		entries: encoded.map(({ pin }) => pin),
		bytes: encoded.reduce((sum, { pin }, index) => sum + pin[0] + (index === 0 ? 0 : 1), 2),
		readChunk: (index, chunk) => Effect.sync(() => encoded[index]?.chunks[chunk]?.slice() ?? null),
	};
};

export const readPinnedJournal = Effect.fnUntraced(function* (journal: SandboxPinnedJournal) {
	const entries: WorkflowReplayJournalEntry[] = [];
	for (const [index, [bytes, chunks]] of journal.entries.entries()) {
		const text = new Uint8Array(bytes);
		for (let chunk = 0; chunk < chunks; chunk += 1) {
			const data = yield* journal.readChunk(index, chunk);
			if (data === null) {
				return null;
			}
			text.set(data, chunk * SANDBOX_JOURNAL_CHUNK_BYTES);
		}
		entries.push(decodeEntry(new TextDecoder().decode(text)));
	}
	return entries;
});
