import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Effect, Schema } from "effect";

import {
	artifactPaths,
	RunManifest,
	RunSummary,
	ScenarioArtifact,
	writeArtifact,
	writeText,
} from "./artifacts";
import { buildReportSkeleton, buildRunSummary } from "./summarize";

/**
 * Rebuilds the run-level artifacts from every scenario file on disk. A canonical run is collected
 * in several driver invocations (one per scenario group), and each invocation only knows about the
 * scenarios it ran.
 */
const outputDirectory = process.argv[2];
const runId = process.argv[3];
if (!outputDirectory || !runId) {
	throw new Error("usage: summarize-run.ts <output-directory> <run-id>");
}

const paths = artifactPaths(outputDirectory);
const decodeScenario = Schema.decodeUnknownEffect(Schema.fromJsonString(ScenarioArtifact));
const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(RunManifest));

await Effect.runPromise(
	Effect.gen(function* () {
		const files = sortBy(
			(yield* Effect.tryPromise(() => readdir(paths.scenariosDirectory))).filter((name) =>
				name.endsWith(".json"),
			),
		);
		const artifacts = yield* Effect.forEach(files, (name) =>
			Effect.tryPromise(() => readFile(join(paths.scenariosDirectory, name), "utf8")).pipe(
				Effect.flatMap(decodeScenario),
			),
		);
		const manifest = yield* Effect.tryPromise(() => readFile(paths.manifestPath, "utf8")).pipe(
			Effect.flatMap(decodeManifest),
			Effect.map((current): RunManifest => ({ ...current, runId })),
		);
		const summary = buildRunSummary(runId, artifacts);
		yield* writeArtifact(RunManifest, paths.manifestPath, manifest);
		yield* writeArtifact(RunSummary, paths.summaryPath, summary);
		yield* writeText(paths.reportPath, buildReportSkeleton(manifest, summary));
		yield* Effect.log("sandbox-resource-baseline.summarized", {
			runId,
			scenarioFiles: files.length,
			scenarios: summary.scenarios.length,
		});
	}),
);
