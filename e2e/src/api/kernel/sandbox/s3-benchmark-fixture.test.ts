import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Effect, FileSystem, Path, Schema } from "effect";

import {
	backgroundStall,
	readAdmissionTimings,
	readMetricWindow,
} from "~/fixtures/kernel/s3-benchmark";
import { describe, expect, it } from "~/support/effect-test";

import { RoleMetricSnapshot, type MetricSnapshot } from "../../../../s3-benchmark-records";

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

const encodeLine = Schema.encodeSync(Schema.fromJsonString(RoleMetricSnapshot));

const timingLine = (executionId: string, ticketWaitMs: number, resumeDelayMs: number) =>
	`timestamp=2026-10-10T00:00:00.000Z level=INFO message="sandbox HTTP admission timing" ticketWaitMs=${ticketWaitMs} resumeDelayMs=${resumeDelayMs} sandboxWorkflowExecutionId=${executionId}\n`;

describe("S3 benchmark fixtures", () => {
	it.live("keeps one metric window per server role", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const directory = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-s3-fixture-" });
			const file = path.join(directory, "otlp.ndjson");
			const lines = [
				{ role: "interactive", snapshot: dispatches(900, 0) },
				{ role: "background", snapshot: dispatches(900, 1) },
				{ role: "background", snapshot: dispatches(1_500, 2) },
				{ role: "interactive", snapshot: dispatches(2_100, 0) },
				{ role: "background", snapshot: dispatches(2_100, 5) },
			];
			yield* fs.writeFileString(file, lines.map((line) => `${encodeLine(line)}\n`).join(""));

			const windows = yield* readMetricWindow(file, 1_000, 2_000);

			expect(sortBy(Object.keys(windows))).toEqual(["background", "interactive"]);
			expect(windows["background"]?.map(({ atMs }) => atMs)).toEqual([900, 1_500, 2_100]);
			expect(windows["interactive"]?.map(({ atMs }) => atMs)).toEqual([900, 2_100]);
		}),
	);

	it("reads background progress from the background role stream", () => {
		const roles = {
			interactive: [dispatches(1_000, 7), dispatches(5_000, 7)],
			background: [dispatches(1_000, 0), dispatches(2_000, 1), dispatches(3_000, 2)],
		};

		expect(backgroundStall(roles, 1_000, 4_000)).toBe(1_000);
		expect(backgroundStall({ all: roles.background }, 1_000, 4_000)).toBe(1_000);
	});

	it.live("keeps admission timings from every role log", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const directory = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-s3-fixture-" });
			const logFile = path.join(directory, "ryot.log");
			yield* fs.writeFileString(logFile, "message=migrations\n");
			yield* fs.writeFileString(
				path.join(directory, "ryot.interactive.log"),
				timingLine("provider-search-1", 5, 2),
			);
			yield* fs.writeFileString(
				path.join(directory, "ryot.background.log"),
				timingLine("provider-population-2", 7, 3),
			);

			const timings = yield* readAdmissionTimings(logFile);

			expect(
				timings.map(({ executionId, ticketWaitMs, resumeDelayMs }) => [
					executionId,
					ticketWaitMs,
					resumeDelayMs,
				]),
			).toEqual([
				["provider-search-1", 5, 2],
				["provider-population-2", 7, 3],
			]);
		}),
	);

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
