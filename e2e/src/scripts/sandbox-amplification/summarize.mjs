// Summarizes matched variant runs from run-variant.sh into per-scenario medians.
// Usage: bun summarize.mjs <output.json> <label>=<probe.jsonl>,<postgres.jsonl>[,<exclusions>] ...
// Exclusions are "scenario#n" probe entries (the nth recorded repetition of that scenario) and
// "postgres:scenario#n" counter entries (its nth invocation), joined with "+".
import { readFileSync, writeFileSync } from "node:fs";

const [outputPath, ...variants] = process.argv.slice(2);
if (!outputPath || variants.length === 0) {
	throw new Error(
		"usage: summarize.mjs <output.json> <label>=<probe.jsonl>,<postgres.jsonl>[,<excluded>]",
	);
}

const readLines = (path) =>
	readFileSync(path, "utf8")
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line));
const median = (values) => {
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};
const round = (value, digits = 2) => Number(value.toFixed(digits));

const summary = {};
for (const variant of variants) {
	const [label, files] = variant.split("=");
	const [probePath, postgresPath, excludedText = ""] = files.split(",");
	const excluded = new Set(excludedText.split("+").filter(Boolean));
	const occurrences = new Map();
	const rows = readLines(probePath).filter((row) => {
		const index = occurrences.get(row.scenario) ?? 0;
		occurrences.set(row.scenario, index + 1);
		return !excluded.has(`${row.scenario}#${index}`);
	});
	const invocations = new Map();
	const postgres = readLines(postgresPath).filter((row) => {
		const index = invocations.get(row.scenario) ?? 0;
		invocations.set(row.scenario, index + 1);
		return !excluded.has(`postgres:${row.scenario}#${index}`);
	});
	const scenarios = {};
	for (const scenario of new Set(rows.map((row) => row.scenario))) {
		const scenarioRows = rows.filter((row) => row.scenario === scenario);
		const pick = (select) => median(scenarioRows.map(select));
		const postgresRows = postgres.filter((row) => row.scenario === scenario);
		const postgresRepetitions = postgresRows.reduce((total, row) => total + row.repetitions, 0);
		scenarios[scenario] = {
			repetitions: scenarioRows.length,
			processes: pick((row) => row.processesSpawned),
			requestsPerRepetition: scenarioRows[0].requests,
			replaysStarted: pick((row) => row.replaysStarted),
			durableRequests: pick((row) => row.durableRequests),
			bunCpuSeconds: round(pick((row) => row.bunCpuSeconds)),
			ryotCpuSeconds: round(pick((row) => row.ryotCpuSeconds)),
			observedJournalBytes: pick((row) => row.observedJournalBytes),
			workersLeft: Math.max(...scenarioRows.map((row) => row.workersLeft)),
			medianDrainedMs: round(
				pick((row) => row.drainedMs),
				0,
			),
			peakBunRssMiB: round(pick((row) => row.peakBunRssBytes) / 2 ** 20, 1),
			failures: scenarioRows.reduce((total, row) => total + row.failures, 0),
			peakDenoRssMiB: round(pick((row) => row.peakDenoRssBytes) / 2 ** 20, 1),
			oomEvents: scenarioRows.reduce((total, row) => total + row.oomEvents, 0),
			peakWorkerRssMiB: round(pick((row) => row.peakWorkerRssBytes) / 2 ** 20, 1),
			medianLatencyMs: round(
				pick((row) => median(row.latencyMs)),
				0,
			),
			replaysFailed: scenarioRows.reduce((total, row) => total + row.replaysFailed, 0),
			peakCgroupMemoryMiB: round(pick((row) => row.peakCgroupMemoryBytes) / 2 ** 20, 1),
			denoCpuSecondsEstimate: round(pick((row) => row.ryotCpuSeconds - row.bunCpuSeconds)),
			peakConcurrentWorkers: Math.max(...scenarioRows.map((row) => row.peakConcurrentWorkers)),
			// PostgreSQL counters cover whole scenario invocations, averaged over their repetitions.
			postgresCpuSecondsPerRepetition:
				postgresRepetitions === 0
					? null
					: round(
							postgresRows.reduce((total, row) => total + row.postgresCpuSeconds, 0) /
								postgresRepetitions,
						),
			postgresCommitsPerRepetition:
				postgresRepetitions === 0
					? null
					: round(
							postgresRows.reduce((total, row) => total + row.postgresCommits, 0) /
								postgresRepetitions,
							0,
						),
		};
	}
	summary[label] = { scenarios, excluded: [...excluded] };
}
writeFileSync(outputPath, `${JSON.stringify(summary, null, "\t")}\n`);
console.log(JSON.stringify(summary, null, 2));
