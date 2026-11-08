import { SandboxRunError } from "@ryot-app/contract/errors";
import {
	chunkSandboxJournalEntry,
	SANDBOX_JOURNAL_CHUNK_BYTES,
	type SandboxJournalFault,
	type SandboxJournalInspection,
	type SandboxJournalPin,
	type SandboxPinnedJournal,
} from "@ryot-app/sandbox/host/pinned-journal";
import { SANDBOX_LIMITS } from "@ryot-app/sandbox/protocol/limits";
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import type { EffectPgDatabase } from "drizzle-orm/effect-postgres";
import { Effect } from "effect";

import type { DatabaseSession } from "#platform/db/session";
import { sandboxJournalEntry as table } from "#schema/tables/sandbox-journal";

type JournalSession = Pick<DatabaseSession["Service"], "run" | "detached">;

const RETENTION_HOURS = 24;
const pinPattern = /^(\d+):(\d+):([0-9a-f]+)$/;

const journalFailure = (message: string) =>
	new SandboxRunError({ message, kind: "infrastructure" });

const encodePin = ([bytes, chunks, digest]: SandboxJournalPin) => `${bytes}:${chunks}:${digest}`;

const decodePin = (pin: string): null | SandboxJournalPin => {
	const match = pinPattern.exec(pin);
	return match?.[1] === undefined || match[2] === undefined || match[3] === undefined
		? null
		: [Number(match[1]), Number(match[2]), match[3]];
};

/** Entries outlive the transaction of whichever write started the script, so each call commits by itself. */
const journalQuery = <A, E>(
	session: JournalSession,
	query: (db: EffectPgDatabase) => Effect.Effect<A, E>,
) => session.detached(session.run(query));

export const appendSandboxJournal = Effect.fn("appendSandboxJournal")(function* (
	session: JournalSession,
	executionId: string,
	firstIndex: number,
	texts: ReadonlyArray<string>,
) {
	if (texts.length === 0) {
		return yield* Effect.void;
	}
	const entries = texts.map((text, offset) => ({
		executionId,
		entryIndex: firstIndex + offset,
		body: Buffer.from(text, "utf8"),
		pin: encodePin(chunkSandboxJournalEntry(text).pin),
	}));
	const existing = yield* journalQuery(session, (db) =>
		db
			.select({ pin: table.pin, entryIndex: table.entryIndex })
			.from(table)
			.where(
				and(
					eq(table.executionId, executionId),
					gte(table.entryIndex, firstIndex),
					lt(table.entryIndex, firstIndex + texts.length),
				),
			),
	).pipe(Effect.orDie);
	const pins = new Map(existing.map(({ pin, entryIndex }) => [entryIndex, pin]));
	for (const entry of entries) {
		const pin = pins.get(entry.entryIndex);
		if (pin !== undefined && pin !== entry.pin) {
			return yield* journalFailure(
				`Sandbox workflow journal[${entry.entryIndex}] diverged from its projected entry`,
			);
		}
	}
	return yield* journalQuery(session, (db) =>
		db.insert(table).values(entries).onConflictDoNothing(),
	).pipe(Effect.orDie, Effect.asVoid);
});

export const inspectSandboxJournal = Effect.fn("inspectSandboxJournal")(function* (
	session: JournalSession,
	executionId: string,
	journalLength: number,
) {
	if (
		!Number.isSafeInteger(journalLength) ||
		journalLength < 0 ||
		journalLength > SANDBOX_LIMITS.hostCalls.total
	) {
		return yield* journalFailure("Sandbox workflow journal length is invalid");
	}
	if (journalLength === 0) {
		return { bytes: 2, entries: [] };
	}
	const rows = yield* journalQuery(session, (db) =>
		db
			.select({ pin: table.pin })
			.from(table)
			.where(and(eq(table.executionId, executionId), lt(table.entryIndex, journalLength)))
			.orderBy(asc(table.entryIndex)),
	).pipe(Effect.mapError(() => journalFailure("Sandbox workflow journal command failed")));
	if (rows.length < journalLength) {
		return null;
	}
	const entries: SandboxJournalPin[] = [];
	let bytes = 2 + Math.max(0, journalLength - 1);
	for (const { pin } of rows) {
		const decoded = decodePin(pin);
		if (decoded === null) {
			return yield* journalFailure("Sandbox workflow journal inspection is invalid");
		}
		bytes += decoded[0];
		if (bytes > SANDBOX_LIMITS.journalBytes) {
			return yield* journalFailure("Sandbox workflow journal projection exceeds its byte limit");
		}
		entries.push(decoded);
	}
	return { bytes, entries };
});

export const pinSandboxJournal = (
	session: JournalSession,
	executionId: string,
	inspection: SandboxJournalInspection,
): SandboxPinnedJournal => {
	let fault: undefined | SandboxJournalFault;
	const fail = (next: SandboxJournalFault) =>
		Effect.sync(() => {
			fault ??= next;
			return null;
		});
	const readChunk = (index: number, chunk: number) => {
		const pin = inspection.entries[index];
		if (fault !== undefined || pin === undefined || chunk < 0 || chunk >= pin[1]) {
			return fail("failed");
		}
		const length = Math.min(
			SANDBOX_JOURNAL_CHUNK_BYTES,
			pin[0] - chunk * SANDBOX_JOURNAL_CHUNK_BYTES,
		);
		return journalQuery(session, (db) =>
			db
				.select({
					pin: table.pin,
					chunk: sql<Uint8Array>`substring(${table.body} from ${
						chunk * SANDBOX_JOURNAL_CHUNK_BYTES + 1
					} for ${length})`,
				})
				.from(table)
				.where(and(eq(table.executionId, executionId), eq(table.entryIndex, index))),
		).pipe(
			Effect.matchEffect({
				onFailure: () => fail("failed"),
				onSuccess: ([row]) => {
					if (row === undefined) {
						return fail("missing");
					}
					return row.pin !== encodePin(pin) || row.chunk.byteLength !== length
						? fail("changed")
						: Effect.succeed(row.chunk);
				},
			}),
		);
	};
	return { ...inspection, readChunk, fault: () => fault };
};

/** A journal only matters while its workflow can replay, which is far shorter than this. */
export const pruneSandboxJournals = (session: JournalSession, limit: number) =>
	journalQuery(session, (db) =>
		db.execute(sql`delete from ${table} where (execution_id, entry_index) in (
			select execution_id, entry_index from ${table}
			where created_at < now() - ${RETENTION_HOURS} * interval '1 hour'
			order by created_at limit ${limit}
		)`),
	).pipe(Effect.asVoid);

export const clearSandboxJournal = (session: JournalSession, executionId: string) =>
	journalQuery(session, (db) => db.delete(table).where(eq(table.executionId, executionId))).pipe(
		Effect.asVoid,
	);
