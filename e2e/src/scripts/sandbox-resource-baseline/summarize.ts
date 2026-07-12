import { percentile } from "~/support/benchmark-workload";

import type { RunManifest, RunSummary, ScenarioArtifact } from "./artifacts";

type ScalingMetric =
	| "peakWorkerCount"
	| "replayJournalBytes"
	| "peakBackendRssBytes"
	| "peakDenoAggregateRssBytes";

const metricValue = (artifact: ScenarioArtifact, metric: ScalingMetric): number => {
	switch (metric) {
		case "peakWorkerCount":
			return artifact.statistics.peakWorkerCount;
		case "replayJournalBytes":
			return artifact.statistics.counterDeltas.replayJournalBytes;
		case "peakBackendRssBytes":
			return artifact.statistics.backendRssBytes.peak;
		case "peakDenoAggregateRssBytes":
			return artifact.statistics.denoAggregateRssBytes.peak;
	}
	return 0;
};

/** The comparisons the plan asks `summary.json` to expose, stated as data rather than prose. */
export const SCALING_COMPARISONS: ReadonlyArray<{
	readonly label: string;
	readonly baseline: string;
	readonly compared: string;
	readonly metric: ScalingMetric;
}> = [
	{
		label: "concurrency",
		baseline: "07-concurrency-1",
		compared: "08-concurrency-2",
		metric: "peakDenoAggregateRssBytes",
	},
	{
		label: "concurrency",
		baseline: "07-concurrency-1",
		compared: "09-concurrency-5",
		metric: "peakDenoAggregateRssBytes",
	},
	{
		label: "concurrency",
		baseline: "07-concurrency-1",
		compared: "10-concurrency-20",
		metric: "peakDenoAggregateRssBytes",
	},
	{
		label: "concurrency",
		baseline: "07-concurrency-1",
		compared: "10-concurrency-20",
		metric: "peakBackendRssBytes",
	},
	{
		label: "replay",
		metric: "replayJournalBytes",
		baseline: "01-direct-no-host",
		compared: "02-direct-1-host-call",
	},
	{
		label: "replay",
		metric: "replayJournalBytes",
		baseline: "01-direct-no-host",
		compared: "03-direct-5-host-calls",
	},
	{
		label: "replay",
		metric: "replayJournalBytes",
		baseline: "01-direct-no-host",
		compared: "04-direct-10-host-calls",
	},
	{
		label: "payload",
		baseline: "01-direct-no-host",
		metric: "peakBackendRssBytes",
		compared: "05-direct-1mib-payload",
	},
	{
		label: "payload",
		baseline: "01-direct-no-host",
		metric: "peakBackendRssBytes",
		compared: "06-direct-large-payload",
	},
	{
		label: "import-fan-out",
		metric: "peakBackendRssBytes",
		baseline: "11-import-no-related",
		compared: "12-import-10-related",
	},
	{
		label: "import-fan-out",
		metric: "peakBackendRssBytes",
		baseline: "11-import-no-related",
		compared: "13-import-100-related",
	},
	{
		label: "import-fan-out",
		baseline: "11-import-no-related",
		metric: "peakDenoAggregateRssBytes",
		compared: "16-import-concurrency-20",
	},
];

const latestByScenario = (artifacts: ReadonlyArray<ScenarioArtifact>) => {
	const byScenario = new Map<string, ScenarioArtifact>();
	for (const artifact of artifacts) {
		const current = byScenario.get(artifact.scenarioId);
		if (current === undefined || artifact.repetition >= current.repetition) {
			byScenario.set(artifact.scenarioId, artifact);
		}
	}
	return byScenario;
};

export const buildRunSummary = (
	runId: string,
	artifacts: ReadonlyArray<ScenarioArtifact>,
): RunSummary => {
	const byScenario = latestByScenario(artifacts);
	const grouped = new Map<string, ScenarioArtifact[]>();
	for (const artifact of artifacts) {
		grouped.set(artifact.scenarioId, [...(grouped.get(artifact.scenarioId) ?? []), artifact]);
	}
	return {
		runId,
		scalingRatios: SCALING_COMPARISONS.flatMap((comparison) => {
			const baseline = byScenario.get(comparison.baseline);
			const compared = byScenario.get(comparison.compared);
			if (baseline === undefined || compared === undefined) {
				return [];
			}
			const baselineValue = metricValue(baseline, comparison.metric);
			const comparedValue = metricValue(compared, comparison.metric);
			return [
				{
					baselineValue,
					comparedValue,
					delta: comparedValue - baselineValue,
					baselineScenarioId: comparison.baseline,
					comparedScenarioId: comparison.compared,
					metric: `${comparison.label}:${comparison.metric}`,
					ratio: baselineValue === 0 ? null : comparedValue / baselineValue,
				},
			];
		}),
		scenarios: [...grouped.entries()].map(([scenarioId, repetitions]) => {
			const requests = repetitions.flatMap((artifact) => artifact.requests);
			const latencies = requests.map(({ latencyMs }) => latencyMs);
			const last = repetitions.at(-1);
			return {
				scenarioId,
				requestCount: requests.length,
				repetitions: repetitions.length,
				outcome: last?.outcome ?? "aborted",
				stopReason: last?.stopReason ?? null,
				concurrency: last?.configuration.concurrency ?? 0,
				peakWorkerCount: last?.statistics.peakWorkerCount ?? 0,
				peakBackendRssBytes: last?.statistics.backendRssBytes.peak ?? 0,
				recoveredAfterMs: last?.statistics.recovery.recoveredAfterMs ?? null,
				replayJournalBytes: last?.statistics.counterDeltas.replayJournalBytes ?? 0,
				peakDenoAggregateRssBytes: last?.statistics.denoAggregateRssBytes.peak ?? 0,
				successCount: requests.filter(({ outcome }) => outcome === "completed").length,
				failureCount: requests.filter(({ outcome }) => outcome !== "completed").length,
				latencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
			};
		}),
	};
};

const UNRESOLVED = "_Unresolved: fill from the recorded artifacts before publishing._";

const section = (heading: string, body: string) => `## ${heading}\n\n${body}\n`;

export const buildReportSkeleton = (manifest: RunManifest, summary: RunSummary) => {
	const scenarioRows = summary.scenarios
		.map(
			(scenario) =>
				`| ${scenario.scenarioId} | ${scenario.outcome} | ${scenario.concurrency} | ${scenario.successCount}/${scenario.requestCount} | ${scenario.peakBackendRssBytes} | ${scenario.peakDenoAggregateRssBytes} | ${scenario.peakWorkerCount} | ${scenario.recoveredAfterMs ?? "null"} |`,
		)
		.join("\n");
	return [
		`# Sandbox Resource Baseline ${manifest.runId}`,
		"",
		section(
			"What was measured",
			[
				`- Image: ${manifest.image.tag ?? "unknown"} (${manifest.image.digest ?? "digest unknown"}, revision ${manifest.image.ociRevision ?? "unknown"}).`,
				`- Host: ${manifest.host.cpuCount ?? "?"} vCPU, ${manifest.host.ramBytes ?? "?"} bytes RAM, swap ${manifest.host.swapBytes ?? "?"} bytes, kernel ${manifest.host.kernel ?? "unknown"}.`,
				`- Application sampling interval: ${manifest.sampleIntervalMs} ms. Host sampling interval: ${manifest.hostSampleIntervalMs} ms.`,
				`- OTLP healthy: ${manifest.health.otlpHealthy}. Host sampler healthy: ${manifest.health.hostSamplerHealthy}. Watchdog healthy: ${manifest.health.watchdogHealthy}.`,
			].join("\n"),
		),
		section("What was not measured", UNRESOLVED),
		section("Reproduction fidelity and known differences from the incident host", UNRESOLVED),
		section(
			"Scenario results",
			[
				"| Scenario | Outcome | Concurrency | Success | Peak Bun RSS | Peak Deno RSS | Peak workers | Recovered after (ms) |",
				"| --- | --- | --- | --- | --- | --- | --- | --- |",
				scenarioRows,
			].join("\n"),
		),
		section(
			"Scaling ratios",
			[
				"| Metric | Baseline | Compared | Baseline value | Compared value | Ratio |",
				"| --- | --- | --- | --- | --- | --- |",
				...summary.scalingRatios.map(
					(ratio) =>
						`| ${ratio.metric} | ${ratio.baselineScenarioId} | ${ratio.comparedScenarioId} | ${ratio.baselineValue} | ${ratio.comparedValue} | ${ratio.ratio ?? "null"} |`,
				),
			].join("\n"),
		),
		section("Idle baseline", UNRESOLVED),
		section("Per-worker and aggregate memory", UNRESOLVED),
		section("Bun memory growth and recovery", UNRESOLVED),
		section("Replay scaling", UNRESOLVED),
		section("CPU, major-fault, page-reclaim, and disk-read scaling", UNRESOLVED),
		section("Full-import phase overlap", UNRESOLVED),
		section("Live YouTube Music comparison", UNRESOLVED),
		section("OOM and watchdog events", UNRESOLVED),
		section("Evidence-backed conclusions", UNRESOLVED),
		section("Hypotheses supported, rejected, or unresolved", UNRESOLVED),
	].join("\n");
};
