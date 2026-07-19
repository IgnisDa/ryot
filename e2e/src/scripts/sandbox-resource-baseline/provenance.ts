import type { RunManifest, ScenarioArtifact } from "./artifacts";

/**
 * Rejects a run whose artifacts cannot be compared: mixed runs without a composite manifest,
 * mixed images or runtimes, an effective concurrency that differs from the declaration, or a
 * missing health record.
 */
export const provenanceErrors = (
	manifest: RunManifest,
	artifacts: ReadonlyArray<ScenarioArtifact>,
) => {
	const errors: string[] = [];
	const allowedRuns = new Set([manifest.runId, ...manifest.constituentRunIds]);
	const invocations = new Set(manifest.invocations.map(({ invocationId }) => invocationId));
	for (const artifact of artifacts) {
		const label = `${artifact.scenarioId}.${artifact.repetition}`;
		if (!allowedRuns.has(artifact.runId)) {
			errors.push(`${label} belongs to run ${artifact.runId}, which the manifest does not list`);
		}
		if (!invocations.has(artifact.invocationId)) {
			errors.push(`${label} was produced by an invocation the manifest does not record`);
		}
		if (artifact.effective.workerConcurrency !== artifact.configuration.workerConcurrency) {
			errors.push(
				`${label} ran at worker concurrency ${artifact.effective.workerConcurrency}, not the declared ${artifact.configuration.workerConcurrency}`,
			);
		}
		if (
			artifact.effective.schedulerDispatchersDisabled !==
			artifact.configuration.schedulerDispatchersDisabled
		) {
			errors.push(`${label} ran with a scheduler dispatcher setting other than declared`);
		}
		if (artifact.outcome !== "skipped" && artifact.cadence.application.sampleCount === 0) {
			errors.push(`${label} has no application health record`);
		}
		if (artifact.outcome !== "skipped" && artifact.cadence.host === null) {
			errors.push(`${label} has no host health record`);
		}
	}
	const distinct = (read: (artifact: ScenarioArtifact) => string | null) =>
		[...new Set(artifacts.map(read))].sort((left, right) =>
			String(left).localeCompare(String(right)),
		);
	const images = distinct(({ effective }) => effective.imageDigest);
	if (images.length > 1) {
		errors.push(`artifacts were built from different images: ${images.join(", ")}`);
	}
	if (manifest.image.digest !== null && images.some((image) => image !== manifest.image.digest)) {
		errors.push("artifact image digests differ from the manifest image digest");
	}
	const runtimes = distinct(
		({ effective }) => `bun ${effective.bunVersion} / deno ${effective.denoVersion}`,
	);
	if (runtimes.length > 1) {
		errors.push(`artifacts ran on different runtimes: ${runtimes.join(", ")}`);
	}
	return errors;
};
