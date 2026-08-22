import { describe, expect, it } from "~/support/effect-test";

import {
	type JscStackTraces,
	summarizeJscStackTraces,
	summarizeV8CpuProfile,
	type V8CpuProfile,
} from "./cpu-profile";

const runnerUrl = "file:///tmp/ryot-sandbox-runner-a1/runner.mjs";
const dependencyUrl = "file:///deno/runtime-v3-x-9f/youtubei.js-17.0.0.mjs";

const node = (id: number, functionName: string, url: string, children: Array<number> = []) => ({
	id,
	children,
	callFrame: { url, functionName, columnNumber: 0, lineNumber: id * 10, scriptId: String(id) },
});

/** Samples land at 0, 1, 2, 5, and 5.5 ms; the last one runs until the 7 ms end time. */
const v8Profile: V8CpuProfile = {
	startTime: 0,
	endTime: 7_000,
	samples: [4, 4, 5, 6, 2],
	timeDeltas: [0, 1_000, 1_000, 3_000, 500],
	nodes: [
		node(1, "(root)", "", [2, 3, 6]),
		node(2, "(program)", ""),
		node(3, "handler", runnerUrl, [4]),
		node(4, "parse", dependencyUrl, [5]),
		node(5, "https://music.example/secret", "https://music.example/player.js"),
		node(6, "(idle)", ""),
	],
};

describe("summarizeV8CpuProfile", () => {
	it("attributes each sample the time until the next sample and excludes idle from shares", () => {
		const summary = summarizeV8CpuProfile(v8Profile);

		expect(summary.sampleCount).toBe(5);
		expect(summary.sampledDurationMs).toBe(7);
		expect(summary.categories).toEqual([
			{ selfMs: 3, share: 0.4615, category: "other" },
			{ selfMs: 2, share: 0.3077, category: "dependency:youtubei.js-17.0.0" },
			{ selfMs: 1.5, share: 0.2308, category: "program" },
			{ selfMs: 0.5, share: null, category: "idle" },
		]);
		expect(summary.topSelfFrames[0]).toEqual({
			line: 50,
			selfMs: 3,
			share: 0.4615,
			category: "other",
			functionName: "<redacted-name>",
		});
	});

	it("reports stacks innermost first without the synthetic root", () => {
		const summary = summarizeV8CpuProfile(v8Profile, { topN: 2 });

		expect(summary.topStacks).toEqual([
			{
				selfMs: 3,
				share: 0.4615,
				frames: [
					{ category: "other", functionName: "<redacted-name>" },
					{ functionName: "parse", category: "dependency:youtubei.js-17.0.0" },
					{ category: "runner", functionName: "handler" },
				],
			},
			{
				selfMs: 2,
				share: 0.3077,
				frames: [
					{ functionName: "parse", category: "dependency:youtubei.js-17.0.0" },
					{ category: "runner", functionName: "handler" },
				],
			},
		]);
		expect(JSON.stringify(summary)).not.toContain("music.example");
	});
});

const NATIVE = 4_294_967_295;

const jscFrame = (name: string, sourceID: number, flags = 0, sourceURL?: string) => ({
	name,
	flags,
	sourceID,
	line: sourceID === NATIVE ? NATIVE : 7,
	...(sourceURL === undefined ? {} : { sourceURL }),
});

describe("summarizeJscStackTraces", () => {
	it("weights every trace by the sampling interval and resolves sources by ID", () => {
		const inner = jscFrame("inner", 1);
		const outer = jscFrame("outer", 2);
		const traces: JscStackTraces = {
			interval: 0.001,
			sources: [
				{ sourceID: 1, url: "/home/ryot/node_modules/@effect/platform/dist/x.js" },
				{ sourceID: 2, url: "/home/ryot/dist/server.js" },
			],
			traces: [
				{ timestamp: 0, frames: [inner, outer] },
				{ timestamp: 0.001, frames: [inner, outer] },
				{ timestamp: 0.5, frames: [inner, outer] },
				{ timestamp: 0.501, frames: [jscFrame("", NATIVE)] },
				{ timestamp: 0.502, frames: [jscFrame("emit", 9, 1, "node:events"), outer] },
			],
		};

		const summary = summarizeJscStackTraces(traces);

		expect(summary.sampledDurationMs).toBe(5);
		expect(summary.categories).toEqual([
			{ selfMs: 3, share: 0.6, category: "dependency:@effect/platform" },
			{ selfMs: 1, share: 0.2, category: "native" },
			{ selfMs: 1, share: 0.2, category: "bun-builtin" },
		]);
		expect(summary.topSelfFrames[1]).toEqual({
			selfMs: 1,
			line: null,
			share: 0.2,
			category: "native",
			functionName: "(anonymous)",
		});
		expect(summary.topStacks[0]?.frames).toEqual([
			{ functionName: "inner", category: "dependency:@effect/platform" },
			{ functionName: "outer", category: "backend-dist" },
		]);
	});
});
