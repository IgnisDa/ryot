import { describe, expect, it } from "~/support/effect-test";

import {
	parseCpuStat,
	parseDiskStat,
	parseIoStat,
	parseMemInfo,
	parseMemoryEvents,
	parseMemoryStat,
	parsePressure,
	parseProcCgroup,
	parseVmRssBytes,
	parseVmStat,
	pickBlockDevice,
	withoutZeroFull,
} from "./parsers";

describe("parseMemInfo", () => {
	it("converts the sampled kilobyte fields to bytes and leaves absent fields null", () => {
		const meminfo = parseMemInfo(
			[
				"MemTotal:        4005292 kB",
				"MemFree:          211020 kB",
				"MemAvailable:    2361172 kB",
				"Buffers:           90264 kB",
				"Cached:          2011236 kB",
				"SwapCached:            0 kB",
				"Active(anon):     950212 kB",
				"SReclaimable:     120436 kB",
				"Dirty:               112 kB",
				"Writeback:             0 kB",
				"SwapTotal:             0 kB",
				"HugePages_Total:       0",
			].join("\n"),
		);

		expect(meminfo).toEqual({
			writebackBytes: 0,
			swapTotalBytes: 0,
			dirtyBytes: 114_688,
			swapFreeBytes: null,
			cachedBytes: 2_059_505_664,
			memTotalBytes: 4_101_419_008,
			sReclaimableBytes: 123_326_464,
			memAvailableBytes: 2_417_840_128,
		});
	});
});

describe("parsePressure", () => {
	it("parses some and full lines", () => {
		expect(
			parsePressure(
				"some avg10=1.25 avg60=0.40 avg300=0.10 total=123456\nfull avg10=11.50 avg60=3.00 avg300=1.00 total=98765\n",
			),
		).toEqual({
			full: { avg60: 3, avg10: 11.5, totalUs: 98_765 },
			some: { avg60: 0.4, avg10: 1.25, totalUs: 123_456 },
		});
	});

	it("reports full as null when the file has no full line", () => {
		expect(parsePressure("some avg10=0.00 avg60=0.00 avg300=0.00 total=42\n").full).toBeNull();
	});

	it("drops an all-zero system CPU full line but keeps a non-zero one", () => {
		const zero = parsePressure(
			"some avg10=2.00 avg60=1.00 avg300=0.50 total=900\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n",
		);
		const nonZero = parsePressure(
			"some avg10=2.00 avg60=1.00 avg300=0.50 total=900\nfull avg10=0.10 avg60=0.00 avg300=0.00 total=7\n",
		);

		expect(withoutZeroFull(zero).full).toBeNull();
		expect(withoutZeroFull(nonZero).full).toEqual({ avg60: 0, avg10: 0.1, totalUs: 7 });
	});
});

describe("parseVmStat", () => {
	it("sums per-source scan and steal counters without double counting the per-type split", () => {
		const vmstat = parseVmStat(
			[
				"nr_free_pages 52000",
				"pgfault 9000000",
				"pgmajfault 1200",
				"workingset_refault_anon 30",
				"workingset_refault_file 4500",
				"pgsteal_kswapd 800",
				"pgsteal_direct 200",
				"pgsteal_khugepaged 5",
				"pgsteal_anon 300",
				"pgsteal_file 705",
				"pgscan_kswapd 1000",
				"pgscan_direct 400",
				"pgscan_khugepaged 10",
				"pgscan_direct_throttle 3",
				"pgscan_anon 500",
				"pgscan_file 910",
				"oom_kill 2",
			].join("\n"),
		);

		expect(vmstat).toEqual({
			oomKill: 2,
			pgscan: 1_410,
			pgsteal: 1_005,
			pgmajfault: 1_200,
			pgscanDirect: 400,
			pgfault: 9_000_000,
			pgscanKswapd: 1_000,
			workingsetRefaultAnon: 30,
			workingsetRefaultFile: 4_500,
		});
	});

	it("reports counters absent from the file as null", () => {
		expect(parseVmStat("pgfault 10\n")).toMatchObject({
			pgscan: null,
			oomKill: null,
			pgsteal: null,
			pgscanDirect: null,
		});
	});
});

describe("parseDiskStat", () => {
	it("names every diskstat field of a modern kernel", () => {
		expect(
			parseDiskStat(
				"   51234     1200  4096000    31000   88000    9000  7200000   120000        2    95000   151000     10      0    8000     5    4000    700\n",
			),
		).toEqual({
			inFlight: 2,
			ioTimeMs: 95_000,
			discardTimeMs: 5,
			flushTimeMs: 700,
			discardsMerged: 0,
			readsMerged: 1_200,
			readTimeMs: 31_000,
			writesMerged: 9_000,
			writeTimeMs: 120_000,
			discardsCompleted: 10,
			readsCompleted: 51_234,
			sectorsRead: 4_096_000,
			writesCompleted: 88_000,
			sectorsDiscarded: 8_000,
			flushesCompleted: 4_000,
			sectorsWritten: 7_200_000,
			weightedIoTimeMs: 151_000,
		});
	});

	it("leaves fields missing from an older kernel's stat file null", () => {
		const disk = parseDiskStat("1 2 3 4 5 6 7 8 9 10 11\n");
		expect(disk.weightedIoTimeMs).toBe(11);
		expect(disk.discardsCompleted).toBeNull();
		expect(disk.flushTimeMs).toBeNull();
	});
});

describe("cgroup parsers", () => {
	it("maps memory.stat keys and leaves absent keys null", () => {
		const stat = parseMemoryStat(
			[
				"anon 734003200",
				"file 209715200",
				"kernel 41943040",
				"kernel_stack 2097152",
				"pagetables 6291456",
				"shmem 0",
				"sock 4096",
				"file_mapped 52428800",
				"file_dirty 8192",
				"active_anon 700000000",
				"inactive_anon 34003200",
				"active_file 100000000",
				"inactive_file 109715200",
				"pgfault 250000",
				"pgmajfault 12",
				"workingset_refault_anon 0",
				"workingset_refault_file 40",
				"pgscan 900",
				"pgsteal 850",
			].join("\n"),
		);

		expect(stat).toMatchObject({
			pgscan: 900,
			pgsteal: 850,
			pgmajfault: 12,
			fileDirty: 8_192,
			anon: 734_003_200,
			kernelStack: 2_097_152,
			fileMapped: 52_428_800,
		});
		expect(parseMemoryStat("anon 1\n").workingsetRefaultFile).toBeNull();
	});

	it("parses memory.events including oom_kill", () => {
		expect(
			parseMemoryEvents("low 0\nhigh 3\nmax 7\noom 1\noom_kill 1\noom_group_kill 0\n"),
		).toEqual({ low: 0, max: 7, oom: 1, high: 3, oomKill: 1 });
	});

	it("parses cpu.stat and leaves throttling null when the cpu controller is not enabled", () => {
		expect(
			parseCpuStat(
				"usage_usec 5000000\nuser_usec 3500000\nsystem_usec 1500000\nnr_periods 0\nnr_throttled 4\nthrottled_usec 20000\n",
			),
		).toEqual({
			nrThrottled: 4,
			userUsec: 3_500_000,
			usageUsec: 5_000_000,
			systemUsec: 1_500_000,
			throttledUsec: 20_000,
		});
		expect(parseCpuStat("usage_usec 10\nuser_usec 6\nsystem_usec 4\n")).toMatchObject({
			nrThrottled: null,
			throttledUsec: null,
		});
	});

	it("sums io.stat over every device and treats an empty file as no I/O", () => {
		expect(
			parseIoStat(
				"8:0 rbytes=1048576 wbytes=4096 rios=10 wios=1 dbytes=0 dios=0\n253:0 rbytes=2048 wbytes=8192 rios=2 wios=3 dbytes=0 dios=0\n",
			),
		).toEqual({ wios: 4, rios: 12, wbytes: 12_288, rbytes: 1_050_624 });
		expect(parseIoStat("")).toEqual({ rios: 0, wios: 0, rbytes: 0, wbytes: 0 });
	});
});

describe("process files", () => {
	it("reads VmRSS in bytes", () => {
		expect(parseVmRssBytes("Name:\tmain\nVmPeak:\t  90000 kB\nVmRSS:\t   41236 kB\n")).toBe(
			42_225_664,
		);
		expect(parseVmRssBytes("Name:\tkthreadd\n")).toBeNull();
	});

	it("takes the unified cgroup path from /proc/<pid>/cgroup", () => {
		expect(
			parseProcCgroup(
				"0::/system.slice/docker-3f4e5d6c7b8a9f0e1d2c3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e9d0c1b2a3f4e.scope\n",
			),
		).toBe(
			"/system.slice/docker-3f4e5d6c7b8a9f0e1d2c3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e9d0c1b2a3f4e.scope",
		);
		expect(parseProcCgroup("12:memory:/docker/abc\n")).toBeNull();
	});
});

describe("pickBlockDevice", () => {
	it("skips virtual devices", () => {
		expect(pickBlockDevice(["zram0", "sr0", "loop0", "dm-0", "vda", "ram0"])).toBe("vda");
		expect(pickBlockDevice(["loop0", "loop1"])).toBeNull();
	});
});
