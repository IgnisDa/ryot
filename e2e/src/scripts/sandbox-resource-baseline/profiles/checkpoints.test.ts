import { describe, expect, it } from "~/support/effect-test";

import {
	type BunCheckpointRecord,
	decodeBackendCheckpointJsonl,
	decodeCheckpointJsonl,
	type DenoCheckpointRecord,
	summarizeCheckpointSeries,
} from "./checkpoints";
import { parseSmapsRollup } from "./smaps";

const MB = 1_048_576;

const deno = (
	sequence: number,
	checkpoint: DenoCheckpointRecord["checkpoint"],
	rssMb: number,
	heapUsedMb: number,
	anonymousKb: number | null = null,
): DenoCheckpointRecord => ({
	sequence,
	checkpoint,
	attempt: 1,
	pid: 4_242,
	timestampMs: 1_000 + sequence * 10,
	heapSnapshotFile: checkpoint === "module-imported" ? "heap-1.heapsnapshot" : null,
	denoMemory: { external: MB, rss: rssMb * MB, heapTotal: 64 * MB, heapUsed: heapUsedMb * MB },
	smapsRollup: anonymousKb === null ? null : parseSmapsRollup(`Anonymous: ${anonymousKb} kB\n`),
});

const bun: BunCheckpointRecord = {
	sequence: 0,
	smapsRollup: null,
	timestampMs: 5_000,
	activeWorkflows: 0,
	heapSnapshotFile: null,
	checkpoint: "fresh-idle",
	cgroupMemoryCurrentBytes: 400 * MB,
	processMemory: {
		rss: 300 * MB,
		external: 8 * MB,
		arrayBuffers: MB,
		heapUsed: 60 * MB,
		heapTotal: 90 * MB,
	},
	jscHeap: {
		heapSize: 60 * MB,
		extraMemorySize: MB,
		objectCount: 250_000,
		globalObjectCount: 2,
		heapCapacity: 90 * MB,
		protectedObjectCount: 10,
		topObjectTypes: [{ count: 90_000, type: "Object" }],
	},
};

/** Recorded out of order: the summary orders by sequence. */
const series = [
	deno(4, "host-call-settled", 300, 100, 200_000),
	deno(0, "runner-ready", 100, 10, 50_000),
	deno(1, "module-imported", 150, 30),
	deno(2, "dependency-settled", 160, 32),
	deno(3, "dependency-settled", 165, 33),
	deno(5, "host-call-settled", 320, 110),
	deno(6, "result-built", 330, 120),
	deno(7, "host-call-settled", 331, 121),
	deno(8, "response-encoded", 335, 90),
];

describe("summarizeCheckpointSeries", () => {
	it("labels the provider client and provider response phases", () => {
		const summary = summarizeCheckpointSeries(series);

		expect(summary.checkpoints.map(({ phase, sequence }) => [sequence, phase])).toEqual([
			[0, null],
			[1, null],
			[2, "provider-client-created"],
			[3, null],
			[4, null],
			[5, "provider-response-received"],
			[6, null],
			[7, null],
			[8, null],
		]);
	});

	it("reports deltas from the first and previous checkpoint and the largest step", () => {
		const summary = summarizeCheckpointSeries(series);
		const hostCall = summary.checkpoints[4];

		expect(hostCall?.deltaFromFirst.rssBytes).toBe(200 * MB);
		expect(hostCall?.deltaFromPrevious?.heapUsedBytes).toBe(67 * MB);
		expect(hostCall?.deltaFromFirst.privateAnonymousBytes).toBe(150_000 * 1_024);
		expect(hostCall?.deltaFromPrevious?.privateAnonymousBytes).toBeNull();
		expect(summary.checkpoints[1]?.hasHeapSnapshot).toBe(true);
		expect(summary.checkpoints[0]?.deltaFromPrevious).toBeNull();
		expect(summary.largestRssDelta).toEqual({
			sequence: 4,
			phase: null,
			deltaBytes: 135 * MB,
			checkpoint: "host-call-settled",
		});
		expect(summary.largestHeapUsedDelta?.sequence).toBe(4);
	});

	it("refuses a series that mixes Deno and Bun records", () => {
		expect(() => summarizeCheckpointSeries([bun, ...series])).toThrow("mixes Deno and Bun");
	});
});

const backendLine = (label: string, action: string, file: string | null) => {
	const { sequence: _sequence, checkpoint: _checkpoint, heapSnapshotFile: _file, ...fields } = bun;
	return JSON.stringify({ ...fields, file, label, action });
};

describe("decodeCheckpointJsonl", () => {
	it("decodes Deno records line by line and skips blank lines", () => {
		const records = decodeCheckpointJsonl(
			`${JSON.stringify(series[0])}\n\n${JSON.stringify(series[1])}\n`,
		);

		expect(records.map(({ checkpoint }) => checkpoint)).toEqual([
			"host-call-settled",
			"runner-ready",
		]);
	});
});

describe("decodeBackendCheckpointJsonl", () => {
	it("numbers backend lines and links only heap-snapshot files to their checkpoint", () => {
		const records = decodeBackendCheckpointJsonl(
			[
				backendLine("fresh-idle", "checkpoint", null),
				backendLine("wave-2", "cpu-stop", "bun-cpu-wave-2.json"),
				backendLine("final", "heap-snapshot", "bun-heap-final.heapsnapshot"),
			].join("\n"),
		);

		expect(
			records.map(({ sequence, checkpoint, heapSnapshotFile }) => ({
				sequence,
				checkpoint,
				heapSnapshotFile,
			})),
		).toEqual([
			{ sequence: 1, heapSnapshotFile: null, checkpoint: "fresh-idle" },
			{ sequence: 2, checkpoint: "wave-2", heapSnapshotFile: null },
			{ sequence: 3, checkpoint: "final", heapSnapshotFile: "bun-heap-final.heapsnapshot" },
		]);
	});

	it("rejects a Bun checkpoint label that is not safe to commit", () => {
		expect(() =>
			decodeBackendCheckpointJsonl(backendLine("after https://example.com", "checkpoint", null)),
		).toThrow();
	});
});
