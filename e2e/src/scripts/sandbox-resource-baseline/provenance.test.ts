import { describe, expect, it } from "~/support/effect-test";

import { runManifest, scenarioArtifact } from "./artifact-fixture";
import { provenanceErrors } from "./provenance";

const artifact = scenarioArtifact({ repetition: 1, scenarioId: "hermetic-c2" });

describe("provenanceErrors", () => {
	it("accepts artifacts from the manifest's run, image and runtimes", () => {
		expect(provenanceErrors(runManifest(), [artifact])).toEqual([]);
	});

	it("rejects an artifact from another run unless a composite manifest lists that run", () => {
		const foreign = { ...artifact, runId: "run-0" };

		expect(provenanceErrors(runManifest(), [foreign])).toEqual([
			"hermetic-c2.1 belongs to run run-0, which the manifest does not list",
		]);
		expect(
			provenanceErrors(runManifest({ constituentRunIds: ["run-1", "run-0"] }), [foreign]),
		).toEqual([]);
	});

	it("rejects artifacts built from different images or runtimes", () => {
		const other = {
			...artifact,
			repetition: 2,
			effective: { ...artifact.effective, denoVersion: "2.9.0", imageDigest: "sha256:other" },
		};

		expect(
			provenanceErrors(runManifest({ image: { ...runManifest().image, digest: null } }), [
				artifact,
				other,
			]),
		).toEqual([
			"artifacts were built from different images: sha256:image, sha256:other",
			"artifacts ran on different runtimes: bun 1.4.0 / deno 2.8.1, bun 1.4.0 / deno 2.9.0",
		]);
	});

	it("rejects an effective concurrency that differs from the scenario declaration", () => {
		const drifted = { ...artifact, effective: { ...artifact.effective, workerConcurrency: 5 } };

		expect(provenanceErrors(runManifest(), [drifted])).toEqual([
			"hermetic-c2.1 ran at worker concurrency 5, not the declared 2",
		]);
	});

	it("rejects missing health records and unrecorded invocations", () => {
		const unhealthy = {
			...artifact,
			invocationId: "invocation-9",
			cadence: { ...artifact.cadence, host: null },
		};

		expect(provenanceErrors(runManifest(), [unhealthy])).toEqual([
			"hermetic-c2.1 was produced by an invocation the manifest does not record",
			"hermetic-c2.1 has no host health record",
		]);
	});
});
