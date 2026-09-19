import { describe, expect, it } from "vitest";

import { parseCgroupMemoryMax, parseProcStatusRssBytes } from "./process-sampling";

describe("sandbox process sampling", () => {
	it("reads resident memory from a proc status block", () => {
		expect(
			parseProcStatusRssBytes(
				"Name:\tdeno\nVmPeak:\t 2354420 kB\nVmRSS:\t  184924 kB\nThreads:\t7\n",
			),
		).toBe(184_924 * 1024);
		expect(parseProcStatusRssBytes("Name:\tdeno\nThreads:\t7\n")).toBeNull();
	});

	it("distinguishes an unlimited memory cgroup from a fixed limit", () => {
		expect(parseCgroupMemoryMax("max\n")).toBeNull();
		expect(parseCgroupMemoryMax("2147483648\n")).toBe(2_147_483_648);
	});
});
