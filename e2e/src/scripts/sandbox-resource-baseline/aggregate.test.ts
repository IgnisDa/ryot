import { describe, expect, it } from "~/support/effect-test";

import { aggregateRun, aggregateScenario, scalingRatio } from "./aggregate";
import { scenarioArtifact } from "./artifact-fixture";
import type { ScenarioArtifact } from "./artifacts";

const repetition = (
	scenarioId: string,
	index: number,
	value: number,
	outcome: ScenarioArtifact["outcome"] = "completed",
) =>
	scenarioArtifact({
		outcome,
		scenarioId,
		repetition: index,
		metrics: {
			"peakDelta.denoAggregateRssBytes": value,
			"requests.throughputPerMinute": value / 10,
		},
	});

const hermeticC1 = [100, 300, 200, 500, 400].map((value, index) =>
	repetition("hermetic-c1", index + 1, value),
);

describe("aggregateScenario", () => {
	it("reports median, p95, minimum and maximum across repetitions", () => {
		const aggregate = aggregateScenario(hermeticC1);

		expect(aggregate.metrics["peakDelta.denoAggregateRssBytes"]).toEqual({
			n: 5,
			p95: 500,
			min: 100,
			max: 500,
			median: 300,
		});
		expect(aggregate.repetitionResults.map((result) => result.repetition)).toEqual([1, 2, 3, 4, 5]);
	});

	it("does not change when repetitions arrive in a different order", () => {
		expect(aggregateScenario(hermeticC1.toReversed())).toEqual(aggregateScenario(hermeticC1));
		expect(aggregateScenario([...hermeticC1.slice(2), ...hermeticC1.slice(0, 2)])).toEqual(
			aggregateScenario(hermeticC1),
		);
	});

	it("excludes aborted and skipped repetitions from resource statistics but still lists them", () => {
		const aggregate = aggregateScenario([
			repetition("hermetic-c2", 1, 100),
			repetition("hermetic-c2", 2, 900, "aborted"),
			repetition("hermetic-c2", 3, 700, "skipped"),
			repetition("hermetic-c2", 4, 300, "failed"),
		]);

		expect(aggregate.metrics["peakDelta.denoAggregateRssBytes"]?.max).toBe(300);
		expect(aggregate.metrics["peakDelta.denoAggregateRssBytes"]?.n).toBe(2);
		expect(aggregate.outcomes).toEqual({
			failed: 1,
			aborted: 1,
			skipped: 1,
			completed: 1,
			truncated: 0,
		});
		expect(aggregate.repetitionResults).toHaveLength(4);
	});

	it("excludes truncated repetitions from resource statistics but still lists them", () => {
		const aggregate = aggregateScenario([
			repetition("hermetic-c2", 1, 100),
			repetition("hermetic-c2", 2, 900, "truncated"),
		]);

		expect(aggregate.metrics["peakDelta.denoAggregateRssBytes"]?.max).toBe(100);
		expect(aggregate.metrics["peakDelta.denoAggregateRssBytes"]?.n).toBe(1);
		expect(aggregate.outcomes).toEqual({
			failed: 0,
			aborted: 0,
			skipped: 0,
			completed: 1,
			truncated: 1,
		});
		expect(aggregate.repetitionResults).toHaveLength(2);
	});
});

describe("scalingRatio", () => {
	it("compares scenario medians", () => {
		const aggregates = aggregateRun([
			...hermeticC1,
			...[200, 600, 400, 1_000, 800].map((value, index) =>
				repetition("hermetic-c2", index + 1, value),
			),
		]);

		expect(
			scalingRatio(aggregates, {
				baseline: "hermetic-c1",
				compared: "hermetic-c2",
				metric: "peakDelta.denoAggregateRssBytes",
			}),
		).toMatchObject({
			ratio: 2,
			baselineMedian: 300,
			comparedMedian: 600,
			unavailableReason: null,
		});
	});

	it("marks the ratio unavailable when a scenario completed fewer than its required repetitions", () => {
		const aggregates = aggregateRun([
			...hermeticC1,
			repetition("hermetic-c5", 1, 900),
			repetition("hermetic-c5", 2, 900, "aborted"),
		]);

		const ratio = scalingRatio(aggregates, {
			baseline: "hermetic-c1",
			compared: "hermetic-c5",
			metric: "peakDelta.denoAggregateRssBytes",
		});

		expect(ratio.ratio).toBeNull();
		expect(ratio.unavailableReason).toBe(
			"fewer than the required repetitions completed for hermetic-c5",
		);
	});
});
