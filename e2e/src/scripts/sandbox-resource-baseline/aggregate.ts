import type {
	MetricAggregate,
	ScalingRatio,
	ScenarioAggregate,
	ScenarioArtifact,
	ScenarioOutcome,
} from "./artifacts";
import { median, p95 } from "./statistics";

const RESOURCE_OUTCOMES: ReadonlySet<ScenarioOutcome> = new Set(["completed", "failed"]);

export const aggregateMetric = (values: ReadonlyArray<number>): MetricAggregate => ({
	n: values.length,
	p95: p95(values),
	median: median(values),
	min: values.length === 0 ? null : Math.min(...values),
	max: values.length === 0 ? null : Math.max(...values),
});

/**
 * Aborted, skipped and truncated repetitions never contribute to resource statistics; every
 * repetition, including them, stays listed individually. A truncated series measured fewer waves
 * than designed, so folding it into a comparison would read a partial series as a full one.
 * Values are sorted before reduction, so the input order of repetitions cannot change an
 * aggregate.
 */
export const aggregateScenario = (
	artifacts: ReadonlyArray<ScenarioArtifact>,
): ScenarioAggregate => {
	const first = artifacts[0];
	if (first === undefined) {
		throw new Error("Cannot aggregate a scenario without repetitions");
	}
	const ordered = [...artifacts].sort((left, right) => left.repetition - right.repetition);
	const counted = ordered.filter(({ outcome }) => RESOURCE_OUTCOMES.has(outcome));
	const names = [...new Set(counted.flatMap(({ metrics }) => Object.keys(metrics)))].sort();
	return {
		repetitions: ordered.length,
		scenarioId: first.scenarioId,
		kind: first.configuration.kind,
		requiredRepetitions: first.configuration.repetitions,
		workerConcurrency: first.configuration.workerConcurrency,
		repetitionResults: ordered.map(({ outcome, metrics, repetition, stopReason }) => ({
			metrics,
			outcome,
			stopReason,
			repetition,
		})),
		metrics: Object.fromEntries(
			names.map((name) => [
				name,
				aggregateMetric(
					counted.flatMap(({ metrics }) => {
						const value = metrics[name];
						return typeof value === "number" ? [value] : [];
					}),
				),
			]),
		),
		outcomes: {
			failed: ordered.filter(({ outcome }) => outcome === "failed").length,
			aborted: ordered.filter(({ outcome }) => outcome === "aborted").length,
			skipped: ordered.filter(({ outcome }) => outcome === "skipped").length,
			completed: ordered.filter(({ outcome }) => outcome === "completed").length,
			truncated: ordered.filter(({ outcome }) => outcome === "truncated").length,
		},
	};
};

export const aggregateRun = (artifacts: ReadonlyArray<ScenarioArtifact>) => {
	const grouped = new Map<string, ScenarioArtifact[]>();
	for (const artifact of artifacts) {
		grouped.set(artifact.scenarioId, [...(grouped.get(artifact.scenarioId) ?? []), artifact]);
	}
	return [...grouped.keys()]
		.sort()
		.map((scenarioId) => aggregateScenario(grouped.get(scenarioId) ?? []));
};

/** A ratio exists only when both scenarios completed their required repetitions. */
export const scalingRatio = (
	aggregates: ReadonlyArray<ScenarioAggregate>,
	input: { readonly metric: string; readonly baseline: string; readonly compared: string },
): ScalingRatio => {
	const baseline = aggregates.find(({ scenarioId }) => scenarioId === input.baseline);
	const compared = aggregates.find(({ scenarioId }) => scenarioId === input.compared);
	const baselineMedian = baseline?.metrics[input.metric]?.median ?? null;
	const comparedMedian = compared?.metrics[input.metric]?.median ?? null;
	const incomplete = [baseline, compared].find(
		(aggregate) =>
			aggregate === undefined ||
			aggregate.outcomes.completed + aggregate.outcomes.failed < aggregate.requiredRepetitions,
	);
	const unavailableReason = ((): string | null => {
		if (baseline === undefined || compared === undefined || incomplete !== undefined) {
			const missing =
				incomplete?.scenarioId ?? (baseline === undefined ? input.baseline : input.compared);
			return `fewer than the required repetitions completed for ${missing}`;
		}
		if (baselineMedian === null || comparedMedian === null) {
			return "metric unavailable";
		}
		return baselineMedian === 0 ? "baseline median is zero" : null;
	})();
	return {
		baselineMedian,
		comparedMedian,
		unavailableReason,
		metric: input.metric,
		baselineScenarioId: input.baseline,
		comparedScenarioId: input.compared,
		ratio:
			unavailableReason === null && baselineMedian !== null && comparedMedian !== null
				? comparedMedian / baselineMedian
				: null,
	};
};
