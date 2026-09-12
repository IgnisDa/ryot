import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";

import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

import { runManifest } from "./artifact-fixture";
import { artifactPaths, RunManifest, writeArtifact } from "./artifacts";
import type { DriverConfig } from "./config";
import { readManifest, recordInvocation } from "./invocations";

const configFor = (outputDirectory: string): DriverConfig => ({
	runId: "run-1",
	outputDirectory,
	imageDigest: null,
	serverIp: "127.0.0.1",
	requestTimeoutMs: 1_000,
	adminAccessToken: "token",
	allowNonCanonicalHost: true,
	apiUrl: "https://ur-testing.ryot.io",
	frontendUrl: "https://ur-testing.ryot.io",
	rawDirectory: join(outputDirectory, "raw"),
	stabilization: { windowMs: 1_000, maxWaitMs: 1_000, maxDriftRatio: 0.05 },
});

describe("recordInvocation", () => {
	it.live("closes a running phase out as failed with its error and completion time", () =>
		Effect.gen(function* () {
			const config = configFor(mkdtempSync(join(tmpdir(), "ryot-invocations-")));
			yield* writeArtifact(
				RunManifest,
				artifactPaths(config.outputDirectory).manifestPath,
				runManifest(),
			);

			yield* recordInvocation(config, {
				scenarioIds: [],
				stopReason: null,
				outcome: "running",
				command: "preflight",
				completedAtUtc: null,
				invocationId: "invocation-9",
				startedAtUtc: "2026-09-22T01:30:37.000Z",
			});
			yield* recordInvocation(config, {
				scenarioIds: [],
				outcome: "failed",
				command: "preflight",
				invocationId: "invocation-9",
				startedAtUtc: "2026-09-22T01:30:37.000Z",
				completedAtUtc: "2026-09-22T01:41:02.000Z",
				stopReason: "RemoteCommandError (exit code 1)",
			});

			const manifest = yield* readManifest(config);
			const recorded = manifest.invocations.filter(
				({ invocationId }) => invocationId === "invocation-9",
			);
			expect(recorded).toHaveLength(1);
			assertPresent(recorded[0], "the failed invocation is recorded");
			expect(recorded[0].command).toBe("preflight");
			expect(recorded[0].outcome).toBe("failed");
			expect(recorded[0].completedAtUtc).toBe("2026-09-22T01:41:02.000Z");
			expect(recorded[0].stopReason).toBe("RemoteCommandError (exit code 1)");
		}),
	);
});
