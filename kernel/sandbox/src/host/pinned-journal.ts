import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import type { Effect } from "effect";
import { Schema } from "effect";

import { MiB, SANDBOX_LIMITS } from "../protocol/limits";

export const SANDBOX_JOURNAL_CHUNK_BYTES = MiB;

const entryPin = Schema.Tuple([
	Schema.Int.check(
		Schema.isBetween({ minimum: 1, maximum: SANDBOX_LIMITS.bridge.durableResponseBytes }),
	),
	Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
	Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
]).check(
	Schema.makeFilter(
		([bytes, chunks]) =>
			chunks === Math.ceil(bytes / SANDBOX_JOURNAL_CHUNK_BYTES) ||
			"Expected one chunk per started MiB",
	),
);
export type SandboxJournalPin = typeof entryPin.Type;
export const SandboxJournalPins = Schema.Array(entryPin).check(
	Schema.isMaxLength(SANDBOX_LIMITS.hostCalls.total),
);

export const SandboxJournalInspection = Schema.Struct({
	entries: SandboxJournalPins,
	bytes: Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: SANDBOX_LIMITS.journalBytes })),
});
export type SandboxJournalInspection = typeof SandboxJournalInspection.Type;

const encoder = new TextEncoder();

export const chunkSandboxJournalEntry = (text: string) => {
	const bytes = encoder.encode(text);
	const chunks: Uint8Array[] = [];
	for (let start = 0; start < bytes.byteLength; start += SANDBOX_JOURNAL_CHUNK_BYTES) {
		chunks.push(bytes.subarray(start, start + SANDBOX_JOURNAL_CHUNK_BYTES));
	}
	const pin: SandboxJournalPin = [bytes.byteLength, chunks.length, sha256Hex(text)];
	return { pin, chunks };
};

export type SandboxJournalFault = "failed" | "changed" | "missing";

export type SandboxPinnedJournal = SandboxJournalInspection & {
	readonly fault: () => undefined | SandboxJournalFault;
	// Null once the projection is unavailable; `fault` then says why.
	readonly readChunk: (index: number, chunk: number) => Effect.Effect<null | Uint8Array>;
};
