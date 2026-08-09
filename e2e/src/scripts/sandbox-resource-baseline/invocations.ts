import { readFile } from "node:fs/promises";

import { Effect, Schema } from "effect";

import { artifactPaths, type ManifestInvocation, RunManifest, writeArtifact } from "./artifacts";
import type { DriverConfig } from "./config";

export const readManifest = (config: DriverConfig) =>
	Effect.tryPromise(() =>
		readFile(artifactPaths(config.outputDirectory).manifestPath, "utf8"),
	).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(RunManifest))));

export const updateManifest = (
	config: DriverConfig,
	update: (manifest: RunManifest) => RunManifest,
) =>
	Effect.flatMap(readManifest(config), (manifest) =>
		writeArtifact(
			RunManifest,
			artifactPaths(config.outputDirectory).manifestPath,
			update(manifest),
		),
	);

/**
 * Records one phase invocation, replacing any earlier record with the same id. A phase that
 * dies mid-flight is closed out with `outcome: "failed"` by the failure handler in `run.ts`;
 * without that replacement the manifest keeps `outcome: "running"` with no `completedAtUtc`,
 * which reads as a phase that never finished.
 */
export const recordInvocation = (config: DriverConfig, invocation: ManifestInvocation) =>
	updateManifest(config, (manifest) => ({
		...manifest,
		invocations: [
			...manifest.invocations.filter(
				({ invocationId }) => invocationId !== invocation.invocationId,
			),
			invocation,
		],
	}));
