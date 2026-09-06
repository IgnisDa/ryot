import type { MetricAggregate, RunManifest, RunSummary, ScenarioAggregate } from "./artifacts";

const MiB = 1_048_576;

const mebibytes = (value: number | null) => (value === null ? "—" : (value / MiB).toFixed(1));

const number = (value: number | null, digits = 1) => (value === null ? "—" : value.toFixed(digits));

const table = (header: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string>>) =>
	[
		`| ${header.join(" | ")} |`,
		`| ${header.map(() => "---").join(" | ")} |`,
		...rows.map((row) => `| ${row.join(" | ")} |`),
	].join("\n");

const metric = (aggregate: ScenarioAggregate, name: string): MetricAggregate | undefined =>
	aggregate.metrics[name];

export const scenarioTable = (aggregates: ReadonlyArray<ScenarioAggregate>) =>
	table(
		[
			"Scenario",
			"Concurrency",
			"Reps (ok/req)",
			"Throughput/min",
			"Request p95 (ms)",
			"Peak Bun RSS Δ (MiB)",
			"Peak Deno RSS Δ (MiB)",
			"Scenario cgroup peak (MiB)",
			"Worker peak (MiB)",
			"Drain (s)",
		],
		aggregates.map((aggregate) => [
			aggregate.scenarioId,
			String(aggregate.workerConcurrency),
			`${aggregate.outcomes.completed}/${aggregate.requiredRepetitions}`,
			number(metric(aggregate, "requests.throughputPerMinute")?.median ?? null),
			number(metric(aggregate, "requests.latencyMs.p95")?.median ?? null, 0),
			mebibytes(metric(aggregate, "peakDelta.bunRssBytes")?.median ?? null),
			mebibytes(metric(aggregate, "peakDelta.denoAggregateRssBytes")?.median ?? null),
			mebibytes(metric(aggregate, "ryot.cgroupScenarioPeakBytes")?.median ?? null),
			mebibytes(metric(aggregate, "workers.lifetimePeakRssMaxBytes")?.median ?? null),
			number(
				(metric(aggregate, "recovery.workersDrainedAfterMs")?.median ?? null) === null
					? null
					: (metric(aggregate, "recovery.workersDrainedAfterMs")?.median ?? 0) / 1_000,
			),
		]),
	);

export const pressureTable = (aggregates: ReadonlyArray<ScenarioAggregate>) =>
	table(
		[
			"Scenario",
			"Ryot CPU (s)",
			"CPU PSI some avg10 max",
			"Memory PSI full avg10 max",
			"MemAvailable min (MiB)",
			"Major faults",
			"Disk sectors read",
			"Health p95 (ms)",
			"DB active max",
		],
		aggregates.map((aggregate) => [
			aggregate.scenarioId,
			number(
				(metric(aggregate, "ryot.cgroupCpuMs")?.median ?? null) === null
					? null
					: (metric(aggregate, "ryot.cgroupCpuMs")?.median ?? 0) / 1_000,
			),
			number(metric(aggregate, "host.cpuPsiSomeAvg10Max")?.median ?? null),
			number(metric(aggregate, "host.memoryPsiFullAvg10Max")?.median ?? null, 2),
			mebibytes(metric(aggregate, "host.memAvailableMinBytes")?.median ?? null),
			number(metric(aggregate, "host.pgmajfaultDelta")?.median ?? null, 0),
			number(metric(aggregate, "host.diskSectorsReadDelta")?.median ?? null, 0),
			number(metric(aggregate, "health.latencyMs.p95")?.median ?? null, 0),
			number(metric(aggregate, "db.activeConnectionsMax")?.median ?? null, 0),
		]),
	);

export const replayTable = (aggregates: ReadonlyArray<ScenarioAggregate>) =>
	table(
		[
			"Scenario",
			"Executions",
			"Processes spawned",
			"Replays started",
			"Durable requests",
			"Journal bytes",
		],
		aggregates.map((aggregate) => [
			aggregate.scenarioId,
			number(metric(aggregate, "counters.executions")?.median ?? null, 0),
			number(metric(aggregate, "counters.processesSpawned")?.median ?? null, 0),
			number(metric(aggregate, "counters.replaysStarted")?.median ?? null, 0),
			number(metric(aggregate, "counters.durableRequests")?.median ?? null, 0),
			number(metric(aggregate, "counters.replayJournalBytes")?.median ?? null, 0),
		]),
	);

export const ratioTable = (summary: RunSummary) =>
	table(
		["Metric", "Baseline", "Compared", "Baseline median", "Compared median", "Ratio"],
		summary.scalingRatios.map((ratio) => [
			ratio.metric,
			ratio.baselineScenarioId,
			ratio.comparedScenarioId,
			number(ratio.baselineMedian, 0),
			number(ratio.comparedMedian, 0),
			ratio.ratio === null ? (ratio.unavailableReason ?? "—") : ratio.ratio.toFixed(2),
		]),
	);

export const cadenceTable = (manifest: RunManifest) =>
	table(
		["Series", "Interval (ms)", "Gate"],
		[
			[
				"application",
				String(manifest.sampling.applicationIntervalMs),
				JSON.stringify(manifest.sampling.applicationGate),
			],
			[
				"host",
				String(manifest.sampling.hostIntervalMs),
				JSON.stringify(manifest.sampling.hostGate),
			],
		],
	);

export const buildReportSkeleton = (manifest: RunManifest, summary: RunSummary) => {
	const aggregates = summary.scenarios;
	const group = (prefix: string) =>
		aggregates.filter(({ scenarioId }) => scenarioId.startsWith(prefix));
	return [
		`# Sandbox Resource Follow-Up ${manifest.runId}`,
		"",
		"## What was measured",
		"",
		`- Image \`${manifest.image.tag ?? "unknown"}\` (${manifest.image.digest ?? "digest unknown"}).`,
		`- Bun ${manifest.runtime.bunVersion ?? "?"}, Deno ${manifest.runtime.denoVersion ?? "?"}, Effect ${manifest.runtime.effectVersion ?? "?"}.`,
		`- Invocations: ${manifest.invocations.length}. Constituent runs: ${manifest.constituentRunIds.join(", ")}.`,
		"",
		cadenceTable(manifest),
		"",
		"## Idle baselines",
		"",
		scenarioTable(group("idle")),
		"",
		"## Hermetic concurrency matrix",
		"",
		scenarioTable(group("hermetic")),
		"",
		pressureTable(group("hermetic")),
		"",
		replayTable(group("hermetic")),
		"",
		"## Live YouTube Music concurrency matrix",
		"",
		scenarioTable(group("live")),
		"",
		pressureTable(group("live")),
		"",
		"## Scaling ratios",
		"",
		ratioTable(summary),
		"",
		"## Retention soaks",
		"",
		scenarioTable(group("soak")),
		"",
		"## Profile attribution",
		"",
		"_Fill from `profiles/summary.json`._",
		"",
		"## Conclusions",
		"",
		"_Correctness, resource, profiling attribution, retention classification, and unresolved hypotheses._",
		"",
	].join("\n");
};
