import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import {
	encodeFairness,
	encodeLatencyTrial,
	type LatencySample,
} from "../../../e2e/s3-benchmark-records";

const SUMMARIZER = new URL("./s3-summarize.ts", import.meta.url).pathname;
const roots: Array<string> = [];

afterAll(() => {
	for (const root of roots) {
		rmSync(root, { force: true, recursive: true });
	}
});

const samples = (count: number, base: number, scale: number): Array<LatencySample> =>
	Array.from({ length: count }, (_, index) => ({
		index,
		input: `input-${index}`,
		startedAtMs: 1_000 + index,
		httpArrivalMs: base * scale * 0.4,
		executionId: `execution-${index}`,
		ticketWaitMs: 5 * scale,
		resumeDelayMs: 2,
		durationMs: base * scale + (index % 20),
	}));

const point = (value: number) => ({
	value,
	sum: null,
	count: null,
	bounds: [],
	buckets: [],
	attributes: {},
});

const snapshot = (atMs: number, scale: number, executions: number) => ({
	atMs,
	metrics: {
		"ryot.sandbox.executions": [point(executions)],
		"ryot.http_admission.ticket_wait": [
			{
				sum: 100 * scale,
				value: null,
				count: 100,
				bounds: [10, 50, 100],
				buckets: [90, 10, 0, 0],
				attributes: { lane: "interactive", policy: "s3-bench" },
			},
		],
	},
});

const trial = (
	mode: "loaded" | "unloaded",
	pair: number,
	options: { details?: number; detailsScale?: number; scale?: number; searchScale?: number } = {},
) => {
	const scale = mode === "loaded" ? (options.scale ?? 1.05) : 1;
	const searchScale = mode === "loaded" ? (options.searchScale ?? scale) : 1;
	const detailsScale = mode === "loaded" ? (options.detailsScale ?? scale) : 1;
	return encodeLatencyTrial({
		mode,
		pair,
		kind: "latency",
		resolutionMs: 10,
		startedAt: "2026-10-09T00:00:00.000Z",
		measureStartedAtMs: 1_000,
		measureEndedAtMs: 2_000,
		warmup: { search: 20, details: 20 },
		configuration: {
			SERVER_LANES: "split",
			SERVER_LOG_LEVEL: "info",
			cpuIterations: 1,
			platform: "linux",
		},
		hashes: { inputs: "inputs", sources: { "fairness.script": "script" } },
		samples: {
			search: samples(200, 100, searchScale),
			details: samples(options.details ?? 200, 1_000, detailsScale),
		},
		saturation: {
			windowMs: 10_000,
			threshold: 0.9,
			required: true,
			proven: mode === "loaded",
			minRollingBusy: mode === "loaded" ? 0.95 : null,
			measurementBusy: mode === "loaded" ? 0.97 : 0.2,
			reachedAtMs: mode === "loaded" ? 500 : null,
		},
		background: {
			maxStallMs: 0,
			gatesFailed: 0,
			continuous: true,
			gatesStarted: mode === "loaded" ? 2 : 0,
			gatesCompleted: mode === "loaded" ? 1 : 0,
			progress: mode === "loaded" ? [{ atMs: 1_500, httpRequests: 10, gatesCompleted: 1 }] : [],
		},
		host: [
			{
				atMs: 1_500,
				cpuBusy: 0.9,
				activeExecutions: 1,
				totalConnections: 5,
				activeConnections: 2,
				serverTreeRssMiB: 500,
				lockWaitingConnections: 0,
			},
		],
		metrics: {
			interactive: [snapshot(900, 0, 10), snapshot(2_100, scale, 13)],
			background: [snapshot(900, 0, 20), snapshot(2_100, scale, 24)],
		},
	});
};

const fairness = (pass: boolean) =>
	encodeFairness({
		kind: "fairness",
		host: [],
		metrics: {},
		windowMs: 1_000,
		windowEndedAtMs: 2_000,
		windowStartedAtMs: 1_000,
		startedAt: "2026-10-09T00:00:00.000Z",
		tolerance: { executions: 4, admissions: 2 },
		configuration: {
			SERVER_LANES: "split",
			SERVER_LOG_LEVEL: "info",
			cpuIterations: 1,
			platform: "linux",
		},
		hashes: { inputs: "inputs", sources: { "fairness.script": "script" } },
		result: { pass, executionDifference: 0, admissionDifference: 0 },
		users: ["a", "b"].map((label) => ({
			label,
			failed: 0,
			failureSamples: [],
			plugins: 1,
			progress: [],
			completedTotal: 10,
			admissionsTotal: 10,
			completedInWindow: 10,
			latencyP50Ms: 1,
			latencyP95Ms: 2,
			admissionsInWindow: 10,
		})),
	});

const writeSet = (build: (write: (name: string, text: string) => void) => void) => {
	const root = mkdtempSync(`${tmpdir()}/s3-summarize-`);
	roots.push(root);
	mkdirSync(root, { recursive: true });
	build((name, text) => writeFileSync(`${root}/${name}`, text));
	return root;
};

const completeSet = (
	override: {
		details?: number;
		detailsScale?: number;
		omit?: string;
		scale?: number;
		searchScale?: number;
	} = {},
) =>
	writeSet((write) => {
		const exitCodes: Record<string, number> = { fairness: 0 };
		for (let pair = 1; pair <= 6; pair += 1) {
			for (const mode of ["unloaded", "loaded"] as const) {
				const name = `${mode}-${pair}`;
				exitCodes[name] = 0;
				if (name === override.omit) {
					continue;
				}
				write(
					`${name}.json`,
					trial(mode, pair, {
						scale: override.scale,
						searchScale: override.searchScale,
						detailsScale: override.detailsScale,
						details: name === "loaded-3" ? override.details : undefined,
					}),
				);
			}
		}
		write("fairness.json", fairness(true));
		write("exit-codes.json", JSON.stringify(exitCodes));
	});

const run = (directory: string) => {
	const result = Bun.spawnSync(["bun", SUMMARIZER, directory]);
	return { exitCode: result.exitCode, output: new TextDecoder().decode(result.stdout) };
};

describe("s3 summarizer validation", () => {
	it("accepts a complete valid set with a pass verdict", () => {
		const { exitCode, output } = run(completeSet());
		expect(exitCode).toBe(0);
		expect(output).toContain("Verdict: **pass**");
	});

	it("rejects a set with one trial record removed", () => {
		const { exitCode, output } = run(completeSet({ omit: "unloaded-4" }));
		expect(exitCode).not.toBe(0);
		expect(output).not.toContain("Verdict: **pass**");
		expect(output).toContain("unloaded-4: missing record");
	});

	it("rejects a set with fewer than 200 details samples", () => {
		const { exitCode, output } = run(completeSet({ details: 199 }));
		expect(exitCode).not.toBe(0);
		expect(output).not.toContain("Verdict: **pass**");
		expect(output).toContain("loaded-3: details has 199 measured samples");
	});

	it("rejects samples without per-sample admission timings", () => {
		const root = completeSet();
		const path = `${root}/unloaded-2.json`;
		const record = JSON.parse(readFileSync(path, "utf8"));
		record.samples.search[0].ticketWaitMs = null;
		writeFileSync(path, JSON.stringify(record));
		const { exitCode, output } = run(root);
		expect(exitCode).not.toBe(0);
		expect(output).toContain("unloaded-2: search has 1 samples without a valid ticket wait");
	});

	it("passes search at 1.2 and details at 1.5 of unloaded and reports the topology", () => {
		const { exitCode, output } = run(completeSet({ searchScale: 1.2, detailsScale: 1.5 }));
		expect(exitCode).toBe(0);
		expect(output).toContain("Verdict: **pass**");
		expect(output).toContain("Topology: SERVER_LANES=split");
	});

	it("fails the verdict when loaded search p95 exceeds 1.25 of unloaded", () => {
		const { exitCode, output } = run(completeSet({ searchScale: 1.3, detailsScale: 1 }));
		expect(exitCode).not.toBe(0);
		expect(output).toContain("Verdict: **fail**");
		expect(output).toMatch(/\| search \|.*\| 1\.25 \| fail \|/);
		expect(output).toMatch(/\| details \|.*\| 1\.6 \| pass \|/);
	});

	it("fails the verdict when loaded details p95 exceeds 1.60 of unloaded", () => {
		const { exitCode, output } = run(completeSet({ searchScale: 1, detailsScale: 1.7 }));
		expect(exitCode).not.toBe(0);
		expect(output).toContain("Verdict: **fail**");
		expect(output).toMatch(/\| search \|.*\| 1\.25 \| pass \|/);
		expect(output).toMatch(/\| details \|.*\| 1\.6 \| fail \|/);
	});

	it("rejects a role whose metrics window has fewer than two snapshots", () => {
		const root = completeSet();
		const path = `${root}/loaded-2.json`;
		const record = JSON.parse(readFileSync(path, "utf8"));
		record.metrics.background = record.metrics.background.slice(0, 1);
		writeFileSync(path, JSON.stringify(record));
		const { exitCode, output } = run(root);
		expect(exitCode).not.toBe(0);
		expect(output).toContain(
			"loaded-2: the background role's OTel metrics window has fewer than two snapshots",
		);
	});

	it("sums the metric deltas of every role", () => {
		const root = completeSet();
		run(root);
		const summary = JSON.parse(readFileSync(`${root}/summary.json`, "utf8"));
		expect(summary.metrics.loaded.executions).toBe(6 * (3 + 4));
	});
});
