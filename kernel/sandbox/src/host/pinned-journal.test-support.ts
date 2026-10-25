import {
	type WorkflowReplayJournalEntry,
	workflowReplayJournalEntrySchema,
} from "@ryot-app/plugin-backend-sdk/workflow";
import { Effect, Schema } from "effect";

import { encodeJson } from "./host-call-args.test-support";
import {
	chunkSandboxJournalEntry,
	SANDBOX_JOURNAL_CHUNK_BYTES,
	type SandboxPinnedJournal,
} from "./pinned-journal";

const decodeEntry = (text: string) =>
	Schema.decodeEffect(Schema.fromJsonString(workflowReplayJournalEntrySchema))(text).pipe(
		Effect.orDie,
	);

export const emptyPinnedJournal: SandboxPinnedJournal = {
	bytes: 2,
	entries: [],
	fault: () => undefined,
	readChunk: () => Effect.succeed(null),
};

export const memoryPinnedJournal = Effect.fnUntraced(function* (
	entries: ReadonlyArray<WorkflowReplayJournalEntry>,
): Effect.fn.Return<SandboxPinnedJournal> {
	const encoded = yield* Effect.forEach(entries, ({ value, request }) =>
		Effect.map(encodeJson({ value, request }), chunkSandboxJournalEntry),
	);
	return {
		fault: () => undefined,
		entries: encoded.map(({ pin }) => pin),
		bytes: encoded.reduce((sum, { pin }, index) => sum + pin[0] + (index === 0 ? 0 : 1), 2),
		readChunk: (index, chunk) => Effect.sync(() => encoded[index]?.chunks[chunk]?.slice() ?? null),
	};
});

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
		entries.push(yield* decodeEntry(new TextDecoder().decode(text)));
	}
	return entries;
});
