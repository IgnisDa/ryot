import { Effect, FileSystem, Path, Schema } from "effect";

import {
	backgroundStall,
	readAdmissionTimings,
	readMetricWindow,
} from "~/fixtures/kernel/s3-benchmark";
import { describe, expect, it } from "~/support/effect-test";

import { MetricSnapshot } from "../../../../s3-benchmark-records";

const dispatches = (atMs: number, background: number): MetricSnapshot => ({
	atMs,
	metrics: {
		"ryot.durable_queue.dispatches": [
			{
				sum: null,
				bounds: [],
				count: null,
				buckets: [],
				value: background,
				attributes: { lane: "background" },
			},
		],
	},
});

const encodeLine = Schema.encodeSync(Schema.fromJsonString(MetricSnapshot));

const timingLine = (executionId: string, ticketWaitMs: number, resumeDelayMs: number) =>
	`timestamp=2026-10-10T00:00:00.000Z level=INFO message="sandbox HTTP admission timing" ticketWaitMs=${ticketWaitMs} resumeDelayMs=${resumeDelayMs} sandboxWorkflowExecutionId=${executionId}\n`;

describe("S3 benchmark fixtures", () => {
	it.live("keeps the snapshots around the measured window", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const directory = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-s3-fixture-" });
			const file = path.join(directory, "otlp.ndjson");
			const lines = [
				dispatches(500, 0),
				dispatches(900, 1),
				dispatches(1_500, 2),
				dispatches(2_100, 5),
				dispatches(3_000, 6),
			];
			yield* fs.writeFileString(file, lines.map((line) => `${encodeLine(line)}\n`).join(""));

			const window = yield* readMetricWindow(file, 1_000, 2_000);

			expect(window.map(({ atMs }) => atMs)).toEqual([900, 1_500, 2_100]);
		}),
	);

	it("measures the longest stretch without background dispatches", () => {
		const snapshots = [dispatches(1_000, 0), dispatches(2_000, 1), dispatches(3_000, 2)];

		expect(backgroundStall(snapshots, 1_000, 4_000)).toBe(1_000);
	});

	it.live("reads the base log of a single process", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const directory = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-s3-fixture-" });
			const logFile = path.join(directory, "ryot.log");
			yield* fs.writeFileString(logFile, timingLine("provider-search-3", 4, 1));

			expect((yield* readAdmissionTimings(logFile)).map(({ executionId }) => executionId)).toEqual([
				"provider-search-3",
			]);
		}),
	);
});
