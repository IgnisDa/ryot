import { describe, expect, it } from "~/support/effect-test";

import { classifySmaps, parseSmapsRollup } from "./smaps";

const rollupText = `55d0c0a5e000-7ffd1c3f9000 ---p 00000000 00:00 0                          [rollup]
Rss:               61440 kB
Pss:               50000 kB
Pss_Dirty:         40000 kB
Pss_Anon:          38000 kB
Pss_File:          10000 kB
Pss_Shmem:          2000 kB
Shared_Clean:       8000 kB
Shared_Dirty:        100 kB
Private_Clean:      3000 kB
Private_Dirty:     50340 kB
Referenced:        61000 kB
Anonymous:         40000 kB
Swap:                  0 kB
`;

describe("parseSmapsRollup", () => {
	it("converts kB fields to bytes and leaves unreported fields null", () => {
		const rollup = parseSmapsRollup(rollupText);

		expect(rollup.rssBytes).toBe(61_440 * 1_024);
		expect(rollup.pssAnonBytes).toBe(38_000 * 1_024);
		expect(rollup.swapBytes).toBe(0);
		expect(parseSmapsRollup("Rss: 4 kB\n").pssFileBytes).toBeNull();
	});
});

describe("classifySmaps", () => {
	it("derives private anonymous, file-backed, shared, and shmem bytes", () => {
		expect(classifySmaps(parseSmapsRollup(rollupText))).toEqual({
			shmemBytes: 2_000 * 1_024,
			sharedBytes: 8_100 * 1_024,
			fileBackedBytes: 10_000 * 1_024,
			privateAnonymousBytes: 40_000 * 1_024,
		});
	});

	it("reports shared bytes as unknown when either shared field is missing", () => {
		expect(classifySmaps(parseSmapsRollup("Shared_Clean: 8 kB\n")).sharedBytes).toBeNull();
	});
});
