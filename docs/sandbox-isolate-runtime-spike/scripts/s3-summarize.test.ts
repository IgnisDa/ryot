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

const snapshot = (atMs: number, scale: number) => ({
	atMs,
	metrics: {
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
	options: { details?: number; scale?: number } = {},
) => {
	const scale = mode === "loaded" ? (options.scale ?? 1.05) : 1;
	return encodeLatencyTrial({
		mode,
		pair,
		kind: "latency",
		resolutionMs: 10,
		startedAt: "2026-10-09T00:00:00.000Z",
		measureStartedAtMs: 1_000,
		measureEndedAtMs: 2_000,
		warmup: { search: 20, details: 20 },
		configuration: { SERVER_LOG_LEVEL: "info", cpuIterations: 1, platform: "linux" },
		hashes: { inputs: "inputs", sources: { "fairness.script": "script" } },
		samples: {
			search: samples(200, 100, scale),
			details: samples(options.details ?? 200, 1_000, scale),
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
		metrics: [snapshot(900, 0), snapshot(2_100, scale)],
	});
};

const fairness = (pass: boolean) =>
	encodeFairness({
		kind: "fairness",
		host: [],
		metrics: [],
		windowMs: 1_000,
		windowEndedAtMs: 2_000,
		windowStartedAtMs: 1_000,
		startedAt: "2026-10-09T00:00:00.000Z",
		tolerance: { executions: 4, admissions: 2 },
		configuration: { SERVER_LOG_LEVEL: "info", cpuIterations: 1, platform: "linux" },
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

const completeSet = (override: { details?: number; omit?: string; scale?: number } = {}) =>
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

	it("fails the verdict when loaded p95 exceeds 1.10 of unloaded", () => {
		const { exitCode, output } = run(completeSet({ scale: 1.5 }));
		expect(exitCode).not.toBe(0);
		expect(output).toContain("Verdict: **fail**");
	});
});
