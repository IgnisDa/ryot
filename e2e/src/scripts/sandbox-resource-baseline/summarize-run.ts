import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { Data, Effect, Schema } from "effect";

import { aggregateRun, scalingRatio } from "./aggregate";
import {
	artifactPaths,
	RunManifest,
	RunSummary,
	ScenarioArtifact,
	writeArtifact,
	writeText,
} from "./artifacts";
import { provenanceErrors } from "./provenance";
import { buildReportSkeleton } from "./report";
import { CONCURRENCY_CANDIDATES, hermeticScenarioId, liveScenarioId } from "./scenarios";

class ProvenanceRejection extends Data.TaggedError("ProvenanceRejection")<{
	readonly errors: ReadonlyArray<string>;
}> {}

const RATIO_METRICS = [
	"requests.throughputPerMinute",
	"requests.latencyMs.p95",
	"peakDelta.bunRssBytes",
	"peakDelta.denoAggregateRssBytes",
	"ryot.cgroupScenarioPeakBytes",
	"ryot.cgroupCpuMs",
	"host.cpuPsiSomeAvg10Max",
	"health.latencyMs.p95",
	"counters.processesSpawned",
	"counters.replayJournalBytes",
] as const;

const outputDirectory = process.argv[2];
if (outputDirectory === undefined) {
	throw new Error("usage: summarize-run.ts <output-directory>");
}

const paths = artifactPaths(outputDirectory);
const decodeScenario = Schema.decodeUnknownEffect(Schema.fromJsonString(ScenarioArtifact));
const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(RunManifest));

const program = Effect.gen(function* () {
	const files = (yield* Effect.tryPromise(() => readdir(paths.scenariosDirectory)))
		.filter((name) => name.endsWith(".json"))
		.sort();
	const artifacts = yield* Effect.forEach(files, (name) =>
		Effect.tryPromise(() => readFile(join(paths.scenariosDirectory, name), "utf8")).pipe(
			Effect.flatMap(decodeScenario),
		),
	);
	const manifest = yield* Effect.tryPromise(() => readFile(paths.manifestPath, "utf8")).pipe(
		Effect.flatMap(decodeManifest),
	);
	const errors = provenanceErrors(manifest, artifacts);
	if (errors.length > 0) {
		return yield* new ProvenanceRejection({ errors });
	}
	const aggregates = aggregateRun(artifacts);
	const ratios = [
		...CONCURRENCY_CANDIDATES.filter((concurrency) => concurrency !== 1).flatMap((concurrency) =>
			RATIO_METRICS.map((metric) =>
				scalingRatio(aggregates, {
					metric,
					baseline: hermeticScenarioId(1),
					compared: hermeticScenarioId(concurrency),
				}),
			),
		),
		...CONCURRENCY_CANDIDATES.filter((concurrency) => concurrency !== 1).flatMap((concurrency) =>
			RATIO_METRICS.map((metric) =>
				scalingRatio(aggregates, {
					metric,
					baseline: liveScenarioId(1),
					compared: liveScenarioId(concurrency),
				}),
			),
		),
		...RATIO_METRICS.map((metric) =>
			scalingRatio(aggregates, {
				metric,
				compared: liveScenarioId(2),
				baseline: hermeticScenarioId(2),
			}),
		),
	];
	const summary: RunSummary = {
		extra: {},
		schemaVersion: 2,
		scalingRatios: ratios,
		runId: manifest.runId,
		scenarios: aggregates,
	};
	yield* writeArtifact(RunSummary, paths.summaryPath, summary);
	yield* writeText(paths.reportPath, buildReportSkeleton(manifest, summary));
	yield* Effect.log("sandbox-resource-baseline.summarized", {
		artifacts: artifacts.length,
		scenarios: aggregates.length,
		ratios: ratios.filter(({ ratio }) => ratio !== null).length,
	});
	return undefined;
});

/**
 * A provenance rejection must exit non-zero like any failed phase: it means the run's artifacts
 * cannot be trusted, and reporting success would let a downstream reader treat them as sound.
 */
await Effect.runPromise(program).catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
