import { describe, expect, it } from "vitest";

import {
	parseCgroupCpuStat,
	parseCgroupKeyedValues,
	parseCgroupMemoryEvents,
	parseCgroupMemoryMax,
	parseCgroupNumber,
	parseProcStatCpu,
	parseProcStatusRssBytes,
} from "./process-sampling";

const procStat =
	"1234 (deno (worker)) S 1 1234 1234 0 -1 4194304 9218 0 0 0 4711 1877 0 0 20 0 17 0 8675309 " +
	"2411724800 46231 18446744073709551615 1 1 0 0 0 0 0 4096 0 0 0 0 17 1 0 0 0 0 0";

describe("sandbox process sampling parsers", () => {
	it("reads resident memory from a proc status block", () => {
		expect(
			parseProcStatusRssBytes(
				"Name:\tdeno\nVmPeak:\t 2354420 kB\nVmRSS:\t  184924 kB\nThreads:\t7\n",
			),
		).toBe(184_924 * 1024);
		expect(parseProcStatusRssBytes("Name:\tdeno\nThreads:\t7\n")).toBeNull();
	});

	it("reads cpu and start ticks past a command name containing spaces and parentheses", () => {
		expect(parseProcStatCpu(procStat)).toEqual({
			userTicks: 4_711,
			systemTicks: 1_877,
			startTimeTicks: 8_675_309,
		});
	});

	it("rejects a truncated proc stat line", () => {
		expect(parseProcStatCpu("1234 (deno) S 1 1234")).toBeNull();
		expect(parseProcStatCpu("garbage without a closing paren")).toBeNull();
	});

	it("parses cgroup scalar files and treats an unlimited maximum as absent", () => {
		expect(parseCgroupNumber("528351232\n")).toBe(528_351_232);
		expect(parseCgroupNumber("\n")).toBeNull();
		expect(parseCgroupMemoryMax("max\n")).toBeNull();
		expect(parseCgroupMemoryMax("2147483648\n")).toBe(2_147_483_648);
	});

	it("parses cgroup keyed files and defaults missing event counters to zero", () => {
		expect(parseCgroupKeyedValues("low 0\nhigh 12\nbogus\n")).toEqual({ low: 0, high: 12 });
		expect(parseCgroupMemoryEvents("low 0\nhigh 12\nmax 3\noom 1\noom_kill 1\n")).toEqual({
			low: 0,
			max: 3,
			oom: 1,
			high: 12,
			oomKill: 1,
		});
		expect(parseCgroupMemoryEvents("low 0\n")).toEqual({
			low: 0,
			max: 0,
			oom: 0,
			high: 0,
			oomKill: 0,
		});
	});

	it("parses cgroup cpu usage and reports absent counters as null", () => {
		expect(
			parseCgroupCpuStat("usage_usec 91208745\nuser_usec 70153000\nsystem_usec 21055745\n"),
		).toEqual({ userUsec: 70_153_000, usageUsec: 91_208_745, systemUsec: 21_055_745 });
		expect(parseCgroupCpuStat("nr_periods 0\n")).toEqual({
			userUsec: null,
			usageUsec: null,
			systemUsec: null,
		});
	});
});
