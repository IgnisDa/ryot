import { expect } from "bun:test";

import { SandboxRunError } from "@ryot-app/contract/errors";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { readPinnedJournal } from "@ryot-app/sandbox/host/pinned-journal.test-support";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import { inspectSandboxJournal, pinSandboxJournal } from "#modules/scripts/replay/journal-store";
import { DatabaseSession } from "#platform/db/session";
import { sandboxJournalEntry } from "#schema/tables/sandbox-journal";
import { testExecutionId } from "#testing/effect";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { appendWorkflowJournal } from "./journal";

const request = (index: number, name: string, input: JsonValue = { index }) => ({
	name,
	index,
	kind: "activity" as const,
	args: { input, scriptSlug: "activity-script" },
});

const entry = (index: number, result: number) => ({
	value: { result },
	request: request(index, `call-${index}`),
});

const rowsOf = (executionId: string) =>
	Effect.flatMap(DatabaseSession, (session) =>
		session.run((db) =>
			db
				.select({ pin: sandboxJournalEntry.pin, entryIndex: sandboxJournalEntry.entryIndex })
				.from(sandboxJournalEntry)
				.where(eq(sandboxJournalEntry.executionId, executionId))
				.orderBy(sandboxJournalEntry.entryIndex),
		),
	);

const readProjectedJournal = Effect.fnUntraced(function* (executionId: string, length: number) {
	const session = yield* DatabaseSession;
	const inspection = yield* inspectSandboxJournal(session, executionId, length);
	return inspection === null
		? null
		: yield* readPinnedJournal(pinSandboxJournal(session, executionId, inspection));
});

layer(isolatedDatabaseLayer("workflow_journal"))((test) => {
	test.effect(
		"appends write-once entries idempotently",
		() =>
			Effect.gen(function* () {
				const executionId = testExecutionId("append");
				const journal = [entry(0, 1), entry(1, 2)];

				yield* appendWorkflowJournal(executionId, 0, journal);
				const projected = yield* rowsOf(executionId);
				yield* appendWorkflowJournal(executionId, 0, journal);

				expect(projected.map(({ entryIndex }) => entryIndex)).toEqual([0, 1]);
				expect(yield* rowsOf(executionId)).toEqual(projected);
			}),
		testTimeout,
	);

	test.effect(
		"writes nothing for an empty suffix",
		() =>
			Effect.gen(function* () {
				const executionId = testExecutionId("empty");

				yield* appendWorkflowJournal(executionId, 0, []);

				expect(yield* rowsOf(executionId)).toEqual([]);
			}),
		testTimeout,
	);

	test.effect(
		"keeps a longer journal when an older activation re-appends a prefix",
		() =>
			Effect.gen(function* () {
				const executionId = testExecutionId("prefix");
				const journal = [entry(0, 1), entry(1, 2), entry(2, 3)];

				yield* appendWorkflowJournal(executionId, 0, journal);
				yield* appendWorkflowJournal(executionId, 0, journal.slice(0, 2));

				expect(yield* readProjectedJournal(executionId, 3)).toEqual(journal);
			}),
		testTimeout,
	);

	test.effect(
		"surfaces a differing re-append as an infrastructure failure naming the index",
		() =>
			Effect.gen(function* () {
				const executionId = testExecutionId("diverge");

				yield* appendWorkflowJournal(executionId, 0, [entry(0, 1), entry(1, 2)]);
				const error = yield* Effect.flip(appendWorkflowJournal(executionId, 1, [entry(1, 99)]));

				expect(error).toBeInstanceOf(SandboxRunError);
				expect(error).toMatchObject({ kind: "infrastructure" });
				expect(error.message).toContain("journal[1]");
			}),
		testTimeout,
	);

	test.effect(
		"reads exactly the requested journal length and ignores later entries",
		() =>
			Effect.gen(function* () {
				const executionId = testExecutionId("exact");
				const journal = [entry(0, 1), entry(1, 2), entry(2, 3)];

				yield* appendWorkflowJournal(executionId, 0, journal);

				expect(yield* readProjectedJournal(executionId, 2)).toEqual(journal.slice(0, 2));
			}),
		testTimeout,
	);

	test.effect(
		"reads an empty journal that was never projected",
		() =>
			Effect.gen(function* () {
				expect(yield* readProjectedJournal(testExecutionId("none"), 0)).toEqual([]);
			}),
		testTimeout,
	);

	test.effect(
		"reports a lost entry as a missing projection",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const executionId = testExecutionId("lost");

				yield* appendWorkflowJournal(executionId, 0, [entry(0, 1), entry(1, 2)]);
				expect(yield* readProjectedJournal(executionId, 2)).toHaveLength(2);

				yield* session.run((db) =>
					db
						.delete(sandboxJournalEntry)
						.where(
							and(
								eq(sandboxJournalEntry.executionId, executionId),
								eq(sandboxJournalEntry.entryIndex, 1),
							),
						),
				);

				expect(yield* readProjectedJournal(executionId, 2)).toBeNull();
				expect(yield* readProjectedJournal(testExecutionId("never-written"), 1)).toBeNull();
			}),
		testTimeout,
	);
});
