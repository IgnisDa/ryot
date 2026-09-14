import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { Clock, Effect, Schema } from "effect";

import {
	createAuthenticatedClient,
	deleteUserAndWait,
	makeSession,
	signInWithPassword,
	uninstallTestPlugin,
} from "~/fixtures/kernel";
import { requirePresent } from "~/support/assertions";

import {
	artifactPaths,
	EMPTY_MANIFEST_FACTS,
	RunManifest,
	RunManifestFacts,
	RunSummary,
	ScenarioArtifact,
	writeArtifact,
	writeRawRun,
	writeText,
} from "./artifacts";
import { type DriverConfig, readDriverConfig } from "./config";
import {
	runScenarioRepetition,
	type ScenarioContext,
	waitForStableBackendRss,
} from "./scenario-runner";
import { CANONICAL_SCENARIOS } from "./scenarios";
import { buildReportSkeleton, buildRunSummary } from "./summarize";
import { installBenchmarkWorkloadPlugin } from "./workload-plugin";

const toIsoUtc = (epochMillis: number) => new Date(epochMillis).toISOString();

const readManifestFacts = (path: string | null) =>
	path === null
		? Effect.succeed(EMPTY_MANIFEST_FACTS)
		: Effect.tryPromise(() => readFile(path, "utf8")).pipe(
				Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(RunManifestFacts))),
			);

const selectedScenarios = (config: DriverConfig) =>
	config.scenarioIds.length === 0
		? CANONICAL_SCENARIOS
		: CANONICAL_SCENARIOS.filter((scenario) => config.scenarioIds.includes(scenario.id));

const buildManifest = (input: {
	readonly startedAtUtc: string;
	readonly config: DriverConfig;
	readonly completedAtUtc: string | null;
	readonly facts: RunManifestFacts;
}): RunManifest => ({
	...input.facts,
	runId: input.config.runId,
	startedAtUtc: input.startedAtUtc,
	completedAtUtc: input.completedAtUtc,
	branch: input.config.manifest.branch,
	prNumber: input.config.manifest.prNumber,
	scenarios: selectedScenarios(input.config),
	sampleIntervalMs: input.config.sampleIntervalMs,
	hostSampleIntervalMs: input.config.hostSampleIntervalMs,
	commits: {
		ciTrigger: input.config.manifest.ciTriggerCommit,
		implementation: input.config.manifest.implementationCommit,
	},
	image: {
		architecture: input.facts.image.architecture,
		tag: input.config.manifest.imageTag ?? input.facts.image.tag,
		digest: input.config.manifest.imageDigest ?? input.facts.image.digest,
		ociRevision: input.config.manifest.ociRevision ?? input.facts.image.ociRevision,
	},
});

/** The OAuth access token expires well inside a canonical run, so every repetition signs in again. */
const refreshedSession = (email: string, password: string) =>
	Effect.gen(function* () {
		const signIn = yield* signInWithPassword(email, password);
		const token = requirePresent(signIn.token, "Benchmark sign-in did not return an access token");
		return makeSession(undefined, { Authorization: `Bearer ${token}` });
	});

const driver = (config: DriverConfig) =>
	Effect.gen(function* () {
		const paths = artifactPaths(config.outputDirectory);
		const startedAtUtc = toIsoUtc(yield* Clock.currentTimeMillis);
		const facts = yield* readManifestFacts(config.manifestFile);
		yield* writeArtifact(
			RunManifest,
			paths.manifestPath,
			buildManifest({ facts, config, startedAtUtc, completedAtUtc: null }),
		);
		const { email, client, userId, password } = yield* createAuthenticatedClient();
		const plugin = yield* installBenchmarkWorkloadPlugin({ client, runId: config.runId });
		const baseContext = {
			userId,
			config,
			runId: config.runId,
			scriptId: plugin.scriptId,
			bookProviderId: plugin.bookProviderId,
		};
		const artifacts: ScenarioArtifact[] = [];
		let stopped = false;
		for (const scenario of selectedScenarios(config)) {
			if (stopped) {
				break;
			}
			for (let repetition = 1; repetition <= scenario.repetitions && !stopped; repetition += 1) {
				if (scenario.kind !== "idle") {
					const stabilization = yield* waitForStableBackendRss(config);
					yield* Effect.log("sandbox-resource-baseline.stabilization", {
						...stabilization,
						repetition,
						scenarioId: scenario.id,
					});
				}
				const context: ScenarioContext = {
					...baseContext,
					client: yield* refreshedSession(email, password),
				};
				const { artifact, rawRequests } = yield* runScenarioRepetition(
					context,
					scenario,
					repetition,
				);
				const fileName = `${scenario.id}.${repetition}.json`;
				yield* writeRawRun(join(paths.rawDirectory, fileName), {
					repetition,
					runId: config.runId,
					requests: rawRequests,
					scenarioId: scenario.id,
				});
				yield* writeArtifact(ScenarioArtifact, join(paths.scenariosDirectory, fileName), artifact);
				artifacts.push(artifact);
				stopped = artifact.outcome === "aborted";
			}
		}
		yield* uninstallTestPlugin({
			...plugin.installed,
			client: yield* refreshedSession(email, password),
		}).pipe(
			Effect.catchCause((cause) =>
				Effect.logWarning("sandbox-resource-baseline.plugin-cleanup-failed", cause),
			),
		);
		yield* deleteUserAndWait(userId).pipe(
			Effect.catchCause((cause) =>
				Effect.logWarning("sandbox-resource-baseline.user-cleanup-failed", cause),
			),
		);
		const summary = buildRunSummary(config.runId, artifacts);
		const manifest = buildManifest({
			facts,
			config,
			startedAtUtc,
			completedAtUtc: toIsoUtc(yield* Clock.currentTimeMillis),
		});
		yield* writeArtifact(RunSummary, paths.summaryPath, summary);
		yield* writeArtifact(RunManifest, paths.manifestPath, manifest);
		yield* writeText(paths.reportPath, buildReportSkeleton(manifest, summary));
		yield* Effect.log("sandbox-resource-baseline.finished", {
			stopped,
			runId: config.runId,
			scenarioCount: artifacts.length,
			outputDirectory: config.outputDirectory,
		});
	});

const config = readDriverConfig(process.env, toIsoUtc(Date.now()));

process.env["E2E_API_URL"] = config.apiUrl;
process.env["E2E_FRONTEND_URL"] = config.frontendUrl;
process.env["E2E_ADMIN_ACCESS_TOKEN"] = config.adminAccessToken;

await Effect.runPromise(driver(config));
