import { Schema } from "effect";

const NullableBytes = Schema.NullOr(Schema.Finite);

export const SmapsRollup = Schema.Struct({
	rssBytes: NullableBytes,
	pssBytes: NullableBytes,
	swapBytes: NullableBytes,
	pssAnonBytes: NullableBytes,
	pssFileBytes: NullableBytes,
	pssShmemBytes: NullableBytes,
	anonymousBytes: NullableBytes,
	sharedCleanBytes: NullableBytes,
	sharedDirtyBytes: NullableBytes,
	privateCleanBytes: NullableBytes,
	privateDirtyBytes: NullableBytes,
});
export type SmapsRollup = typeof SmapsRollup.Type;

const rollupFields: Record<string, keyof SmapsRollup> = {
	Rss: "rssBytes",
	Pss: "pssBytes",
	Swap: "swapBytes",
	Pss_Anon: "pssAnonBytes",
	Pss_File: "pssFileBytes",
	Pss_Shmem: "pssShmemBytes",
	Anonymous: "anonymousBytes",
	Shared_Clean: "sharedCleanBytes",
	Shared_Dirty: "sharedDirtyBytes",
	Private_Clean: "privateCleanBytes",
	Private_Dirty: "privateDirtyBytes",
};

/** Parses `/proc/<pid>/smaps_rollup`; a field the kernel does not report stays null. */
export const parseSmapsRollup = (text: string): SmapsRollup => {
	const rollup: Record<keyof SmapsRollup, number | null> = {
		rssBytes: null,
		pssBytes: null,
		swapBytes: null,
		pssAnonBytes: null,
		pssFileBytes: null,
		pssShmemBytes: null,
		anonymousBytes: null,
		sharedCleanBytes: null,
		sharedDirtyBytes: null,
		privateCleanBytes: null,
		privateDirtyBytes: null,
	};
	for (const line of text.split("\n")) {
		const match = /^(\w+):\s+(\d+) kB$/.exec(line.trim());
		const field = match?.[1] === undefined ? undefined : rollupFields[match[1]];
		if (field !== undefined) {
			rollup[field] = Number(match?.[2]) * 1_024;
		}
	}
	return rollup;
};

export const SmapsClassification = Schema.Struct({
	shmemBytes: NullableBytes,
	sharedBytes: NullableBytes,
	fileBackedBytes: NullableBytes,
	privateAnonymousBytes: NullableBytes,
});
export type SmapsClassification = typeof SmapsClassification.Type;

/**
 * Approximate memory classes, each null when its source field is missing:
 * - private anonymous: `Anonymous` (heaps, stacks, allocator arenas). The kernel does not split it
 *   by sharing, but a freshly exec'd runtime shares no anonymous pages with another process.
 * - file-backed: `Pss_File` (mapped executables, libraries, and snapshots, proportionally shared).
 * - shared: `Shared_Clean + Shared_Dirty` (pages mapped by more than one process, any backing).
 * - shmem: `Pss_Shmem` (tmpfs and shared anonymous mappings).
 * The classes overlap (a shared file page counts as file-backed and shared) and are not a partition
 * of RSS.
 */
export const classifySmaps = (rollup: SmapsRollup): SmapsClassification => ({
	shmemBytes: rollup.pssShmemBytes,
	fileBackedBytes: rollup.pssFileBytes,
	privateAnonymousBytes: rollup.anonymousBytes,
	sharedBytes:
		rollup.sharedCleanBytes === null || rollup.sharedDirtyBytes === null
			? null
			: rollup.sharedCleanBytes + rollup.sharedDirtyBytes,
});
