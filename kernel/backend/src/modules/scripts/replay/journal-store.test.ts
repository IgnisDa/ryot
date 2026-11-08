import { expect } from "bun:test";

import { utf8ByteLength } from "@ryot-app/plugin-backend-compiler/limits";
import { SANDBOX_JOURNAL_CHUNK_BYTES } from "@ryot-app/sandbox/host/pinned-journal";
import { readPinnedJournal } from "@ryot-app/sandbox/host/pinned-journal.test-support";
import { MiB, SANDBOX_LIMITS } from "@ryot-app/sandbox/protocol/limits";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { layer } from "@voila.dev/effect-bun-test";
import { and, asc, eq, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { sandboxJournalEntry } from "#schema/tables/sandbox-journal";
import { testExecutionId } from "#testing/effect";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { appendWorkflowJournal } from "./journal";
import { inspectSandboxJournal, pinSandboxJournal, pruneSandboxJournals } from "./journal-store";

const entry = (index: number, value: string) => ({
	value,
	request: {
		index,
		name: `call-${index}`,
		kind: "activity" as const,
		args: { input: null, scriptSlug: "activity" },
	},
});
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const entryRow = (executionId: string, index: number) =>
	and(eq(sandboxJournalEntry.executionId, executionId), eq(sandboxJournalEntry.entryIndex, index));

const rowsOf = (executionId: string) =>
	Effect.flatMap(DatabaseSession, (session) =>
		session.run((db) =>
			db
				.select({
					pin: sandboxJournalEntry.pin,
					body: sandboxJournalEntry.body,
					entryIndex: sandboxJournalEntry.entryIndex,
				})
				.from(sandboxJournalEntry)
				.where(eq(sandboxJournalEntry.executionId, executionId))
				.orderBy(asc(sandboxJournalEntry.entryIndex)),
		),
	);

layer(isolatedDatabaseLayer("journal_store"))((test) => {
	test.effect(
		"journal inspection pins exact prefix bytes without returning values",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const executionId = testExecutionId("inspect-prefix");
				const journal = [entry(0, "日本語 🎵"), entry(1, "second"), entry(2, "later")];
				yield* appendWorkflowJournal(executionId, 0, journal);

				const inspection = yield* inspectSandboxJournal(session, executionId, 2);
				assert(inspection !== null);
				expect(inspection.bytes).toBe(utf8ByteLength(yield* encodeJson(journal.slice(0, 2))));
				expect(inspection.entries).toEqual<unknown>(
					yield* Effect.forEach(journal.slice(0, 2), (value) =>
						Effect.map(encodeJson(value), (text) => [utf8ByteLength(text), 1, sha256Hex(text)]),
					),
				);
				expect(yield* inspectSandboxJournal(session, executionId, 0)).toEqual({
					bytes: 2,
					entries: [],
				});
			}),
		testTimeout,
	);

	test.effect(
		"journal inspection bounds its pins before loading values",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const executionId = testExecutionId("oversized-inspection");
				yield* session.run((db) =>
					db
						.insert(sandboxJournalEntry)
						.values({
							executionId,
							entryIndex: 0,
							body: Buffer.from("x"),
							pin: `${SANDBOX_LIMITS.journalBytes}:100:${"0".repeat(64)}`,
						}),
				);

				const error = yield* Effect.flip(inspectSandboxJournal(session, executionId, 1));
				expect(error.kind).toBe("infrastructure");
				expect(error.message).toBe("Sandbox workflow journal projection exceeds its byte limit");
				expect(yield* inspectSandboxJournal(session, executionId, 2)).toBeNull();
			}),
		testTimeout,
	);

	test.effect(
		"lazy journal reads serve pinned chunks and fault on changed or missing entries",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const executionId = testExecutionId("chunked");
				const large = entry(1, `${"x".repeat(MiB - 40)}${"日本語".repeat(500_000)}`);
				const journal = [entry(0, "small"), large];
				yield* appendWorkflowJournal(executionId, 0, journal);
				const inspection = yield* inspectSandboxJournal(session, executionId, 2);
				assert(inspection !== null);
				const largeBytes = utf8ByteLength(yield* encodeJson(large));
				const largeChunks = Math.ceil(largeBytes / SANDBOX_JOURNAL_CHUNK_BYTES);
				expect(largeChunks).toBeGreaterThan(2);
				expect(inspection.entries[1]?.slice(0, 2)).toEqual([largeBytes, largeChunks]);

				yield* appendWorkflowJournal(executionId, 2, [entry(2, "suffix")]);
				const pinned = pinSandboxJournal(session, executionId, inspection);
				expect(yield* readPinnedJournal(pinned)).toEqual(journal);
				const lastChunk = yield* pinned.readChunk(1, largeChunks - 1);
				expect(lastChunk?.byteLength).toBe(
					largeBytes - (largeChunks - 1) * SANDBOX_JOURNAL_CHUNK_BYTES,
				);
				expect(yield* pinned.readChunk(2, 0)).toBeNull();
				expect(pinned.fault()).toBe("failed");

				yield* session.run((db) =>
					db
						.update(sandboxJournalEntry)
						.set({ body: Buffer.from("short") })
						.where(entryRow(executionId, 1)),
				);
				const changedChunk = pinSandboxJournal(session, executionId, inspection);
				expect(yield* changedChunk.readChunk(0, 0)).not.toBeNull();
				expect(yield* changedChunk.readChunk(1, 1)).toBeNull();
				expect(changedChunk.fault()).toBe("changed");

				yield* session.run((db) =>
					db
						.update(sandboxJournalEntry)
						.set({ pin: `1:1:${"0".repeat(64)}` })
						.where(entryRow(executionId, 0)),
				);
				const changedPin = pinSandboxJournal(session, executionId, inspection);
				expect(yield* changedPin.readChunk(0, 0)).toBeNull();
				expect(changedPin.fault()).toBe("changed");

				yield* session.run((db) => db.delete(sandboxJournalEntry).where(entryRow(executionId, 1)));
				const missing = pinSandboxJournal(session, executionId, inspection);
				expect(yield* missing.readChunk(1, 2)).toBeNull();
				expect(missing.fault()).toBe("missing");
				expect(yield* missing.readChunk(1, 0)).toBeNull();
				expect(missing.fault()).toBe("missing");
			}),
		testTimeout,
	);

	test.effect(
		"journal projection rejects divergent appends without writing",
		() =>
			Effect.gen(function* () {
				const executionId = testExecutionId("divergent");
				const original = entry(0, "o".repeat(MiB + 1));
				yield* appendWorkflowJournal(executionId, 0, [original]);
				yield* appendWorkflowJournal(executionId, 2, [entry(2, "projected")]);
				const projected = yield* rowsOf(executionId);
				yield* appendWorkflowJournal(executionId, 0, [original]);

				const error = yield* Effect.flip(
					appendWorkflowJournal(executionId, 0, [original, entry(1, "new"), entry(2, "different")]),
				);
				expect(error.message).toBe("Sandbox workflow journal[2] diverged from its projected entry");
				const conflicting = yield* Effect.flip(
					appendWorkflowJournal(executionId, 0, [entry(0, "o".repeat(MiB + 1).replace(/o$/, "p"))]),
				);
				expect(conflicting.message).toBe(
					"Sandbox workflow journal[0] diverged from its projected entry",
				);
				expect(yield* rowsOf(executionId)).toEqual(projected);
			}),
		testTimeout,
	);

	test.effect(
		"journal inspection rejects invalid lengths and unreadable pins",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const executionId = testExecutionId("invalid-inspection");
				for (const length of [-1, 0.5, Number.NaN, SANDBOX_LIMITS.hostCalls.total + 1]) {
					const error = yield* Effect.flip(inspectSandboxJournal(session, executionId, length));
					expect(error.message).toBe("Sandbox workflow journal length is invalid");
				}
				yield* session.run((db) =>
					db
						.insert(sandboxJournalEntry)
						.values({ executionId, entryIndex: 0, pin: "not-a-pin", body: Buffer.from("x") }),
				);
				const error = yield* Effect.flip(inspectSandboxJournal(session, executionId, 1));
				expect(error.kind).toBe("infrastructure");
				expect(error.message).toBe("Sandbox workflow journal inspection is invalid");
			}),
		testTimeout,
	);
	test.effect(
		"prunes expired projections in bounded batches and allows their reconstruction",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const expired = testExecutionId("expired-projection");
				const recent = testExecutionId("recent-projection");
				const values = [entry(0, "first"), entry(1, "second")];
				yield* appendWorkflowJournal(expired, 0, values);
				yield* appendWorkflowJournal(recent, 0, [entry(0, "recent")]);
				yield* session.run((db) =>
					db
						.update(sandboxJournalEntry)
						.set({ createdAt: sql`now() - interval '25 hours'` })
						.where(eq(sandboxJournalEntry.executionId, expired)),
				);
				yield* session.run((db) =>
					db
						.update(sandboxJournalEntry)
						.set({ createdAt: sql`now() - interval '23 hours'` })
						.where(eq(sandboxJournalEntry.executionId, recent)),
				);
				yield* pruneSandboxJournals(session, 1);
				expect(yield* rowsOf(expired)).toHaveLength(1);
				expect(yield* rowsOf(recent)).toHaveLength(1);
				yield* pruneSandboxJournals(session, 1);
				expect(yield* rowsOf(expired)).toHaveLength(0);
				expect(yield* rowsOf(recent)).toHaveLength(1);
				yield* appendWorkflowJournal(expired, 0, values);
				const inspection = yield* inspectSandboxJournal(session, expired, values.length);
				assert(inspection !== null);
				expect(inspection.entries).toHaveLength(2);
				yield* pruneSandboxJournals(session, 10);
				expect(yield* rowsOf(expired)).toHaveLength(2);
				expect(yield* rowsOf(recent)).toHaveLength(1);
			}),
		testTimeout,
	);
});
