import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Effect, Schema } from "effect";

import {
	artifactPaths,
	RunManifest,
	RunManifestFacts,
	RunSummary,
	ScenarioArtifact,
	writeArtifact,
	writeText,
} from "./artifacts";
import { CANONICAL_SCENARIOS } from "./scenarios";
import { buildReportSkeleton, buildRunSummary } from "./summarize";

/**
 * Rebuilds the run-level artifacts from every scenario file on disk. A canonical run is collected
 * in several driver invocations (one per scenario group), and each invocation only knows about the
 * scenarios it ran. An optional facts file replaces facts only known once the run has ended.
 */
const outputDirectory = process.argv[2];
const runId = process.argv[3];
const factsFile = process.argv[4];
if (!outputDirectory || !runId) {
	throw new Error("usage: summarize-run.ts <output-directory> <run-id> [manifest-facts-file]");
}

const paths = artifactPaths(outputDirectory);
const decodeScenario = Schema.decodeUnknownEffect(Schema.fromJsonString(ScenarioArtifact));
const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(RunManifest));
const decodeFacts = Schema.decodeUnknownEffect(Schema.fromJsonString(RunManifestFacts));

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
		const current = yield* Effect.tryPromise(() => readFile(paths.manifestPath, "utf8")).pipe(
			Effect.flatMap(decodeManifest),
		);
		const facts =
			factsFile === undefined
				? {}
				: yield* Effect.tryPromise(() => readFile(factsFile, "utf8")).pipe(
						Effect.flatMap(decodeFacts),
					);
		const manifest: RunManifest = { ...current, ...facts, runId, scenarios: CANONICAL_SCENARIOS };
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
