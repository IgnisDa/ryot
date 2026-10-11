import { describe, expect, it } from "vitest";

import { parseProcStatusRssBytes } from "./process-sampling";

describe("sandbox process sampling", () => {
	it("reads resident memory from a proc status block", () => {
		expect(
			parseProcStatusRssBytes(
				"Name:\tryot-sandboxd\nVmPeak:\t 2354420 kB\nVmRSS:\t  184924 kB\nThreads:\t7\n",
			),
		).toBe(184_924 * 1024);
		expect(parseProcStatusRssBytes("Name:\tryot-sandboxd\nThreads:\t7\n")).toBeNull();
	});
});
