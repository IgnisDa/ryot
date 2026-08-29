import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { SandboxProviderId, SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { Cause, Clock, Data, Effect, Schema } from "effect";

import { adminHeaders, createAuthenticatedClient, getApiClient } from "~/fixtures/kernel";
import { requirePresent } from "~/support/assertions";

import { decodeAppLines } from "./app-samples";
import {
	artifactPaths,
	RunManifest,
	ScenarioArtifact,
	scenarioFileName,
	writeArtifact,
	writeRawJson,
} from "./artifacts";
import { APPLICATION_CADENCE_GATE, evaluateCadenceGate, HOST_CADENCE_GATE } from "./cadence";
import { type DriverConfig, readDriverConfig } from "./config";
import { recordInvocation, updateManifest } from "./invocations";
import { makeRemote, REMOTE_FILES } from "./ops";
import { runProfileScenarios } from "./profile-run";
import {
	type RepetitionPlan,
	resilientSession,
	type RunContext,
	runFreshRepetition,
	sampleRuntime,
	searchYoutubeMusic,
	waitForHealth,
} from "./scenario-runner";
import {
	ALL_SCENARIOS,
	CONCURRENCY_CANDIDATES,
	counterbalancedOrder,
	findScenario,
	HERMETIC_SCENARIOS,
	hermeticScenarioId,
	IDLE_SCENARIOS,
	LIVE_SCENARIOS,
	liveScenarioId,
	PROFILE_SCENARIOS,
	type ScenarioDefinition,
	SOAK_SCENARIOS,
	VARIANCE_SCENARIOS,
} from "./scenarios";
import { runSoak } from "./soak-run";

const DriverStateSchema = Schema.Struct({
	email: Schema.String,
	userId: Schema.String,
	password: Schema.String,
	pluginSlug: Schema.String,
	scriptId: SandboxScriptId,
	bookProviderId: SandboxProviderId,
	liveExternalIds: Schema.Array(Schema.String),
	youtubeMusic: Schema.Struct({ providerId: SandboxProviderId, detailsScriptId: SandboxScriptId }),
});
type PersistedState = typeof DriverStateSchema.Type;

const statePath = (config: DriverConfig) => join(config.rawDirectory, "state.json");
const rawScenarioPath = (config: DriverConfig, scenarioId: string, repetition: number) =>
	join(config.rawDirectory, "scenarios", `${scenarioId}.${repetition}.json`);

const readState = (config: DriverConfig) =>
	Effect.tryPromise(() => readFile(statePath(config), "utf8")).pipe(
		Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(DriverStateSchema))),
	);

const writeState = (config: DriverConfig, state: PersistedState) =>
	writeRawJson(statePath(config), state);

const isoNow = Effect.map(Clock.currentTimeMillis, (millis) => new Date(millis).toISOString());

const makeContext = (config: DriverConfig, invocationId: string) =>
	Effect.gen(function* () {
		const state = yield* readState(config);
		const session = yield* resilientSession(state.email, state.password);
		const context: RunContext = {
			state,
			config,
			session,
			invocationId,
			runId: config.runId,
			remote: makeRemote(config.serverIp),
		};
		return { state, context };
	});

const persistArtifact = (config: DriverConfig, artifact: ScenarioArtifact) =>
	Effect.gen(function* () {
		const paths = artifactPaths(config.outputDirectory);
		const fileName = scenarioFileName(artifact.scenarioId, artifact.repetition);
		yield* writeRawJson(rawScenarioPath(config, artifact.scenarioId, artifact.repetition), {
			metrics: artifact.metrics,
			requests: artifact.requests,
			scenarioId: artifact.scenarioId,
			repetition: artifact.repetition,
		});
		yield* writeArtifact(ScenarioArtifact, join(paths.scenariosDirectory, fileName), artifact);
		yield* Effect.log("sandbox-resource-baseline.artifact", {
			fileName,
			outcome: artifact.outcome,
			stopReason: artifact.stopReason,
			peakBunRss: artifact.metrics["peak.bunRssBytes"],
			throughput: artifact.metrics["requests.throughputPerMinute"],
		});
		return artifact;
	});

const setup = (config: DriverConfig) =>
	Effect.gen(function* () {
		const { email, client, userId, password } = yield* createAuthenticatedClient();
		const pluginSlug = `sandbox-resource-baseline-${config.runId.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;
		const { installBenchmarkWorkloadPlugin } = yield* Effect.promise(
			() => import("./workload-plugin"),
		);
		const plugin = yield* installBenchmarkWorkloadPlugin({ client, runId: config.runId });
		const scripts = yield* getApiClient().call(
			(api) => api.testSupport.listSandboxScripts({ query: {} }),
			adminHeaders(),
		);
		const details = requirePresent(
			scripts.find(({ slug }) => slug === "music.youtube-music.details"),
			"the shipped YouTube Music details script is not installed",
		);
		const state: PersistedState = {
			email,
			userId,
			password,
			liveExternalIds: [],
			scriptId: plugin.scriptId,
			pluginSlug: plugin.pluginSlug,
			bookProviderId: plugin.bookProviderId,
			youtubeMusic: {
				detailsScriptId: details.id,
				providerId: requirePresent(details.providerId, "YouTube Music provider id is missing"),
			},
		};
		yield* writeState(config, state);
		yield* Effect.log("sandbox-resource-baseline.setup", { userId, pluginSlug });
		return state;
	});

const captureLiveResults = (context: RunContext) =>
	Effect.gen(function* () {
		const found = yield* searchYoutubeMusic(context, 20, "furious");
		const externalIds = found.items.map(({ externalId }) => externalId);
		yield* writeState(context.config, { ...context.state, liveExternalIds: externalIds });
		return externalIds;
	});

const preflight = (config: DriverConfig, invocationId: string) =>
	Effect.gen(function* () {
		const { context } = yield* makeContext(config, invocationId);
		const { remote } = context;
		yield* remote.startHostSampler;
		yield* remote.writeTokenFile(config.adminAccessToken);
		yield* remote.startAppCollector;
		const drill = yield* remote.watchdogDrill;
		const [appOffset, hostOffset] = yield* Effect.all([
			remote.fileSize(REMOTE_FILES.appSamples),
			remote.fileSize(REMOTE_FILES.hostSamples),
		]);
		const otlpBefore = yield* remote.otlpOutputSizes;
		yield* Effect.log("sandbox-resource-baseline.preflight.sampling", { minutes: 10 });
		yield* Effect.sleep("10 minutes");
		const [appOutput, hostOutput] = yield* Effect.all([
			remote.readAppended(REMOTE_FILES.appSamples, appOffset),
			remote.readAppended(REMOTE_FILES.hostSamples, hostOffset),
		]);
		const app = decodeAppLines(appOutput);
		const host = remote.decodeSamples(hostOutput);
		const application = evaluateCadenceGate(app.samples, 200, APPLICATION_CADENCE_GATE);
		const hostCadence = evaluateCadenceGate(host.samples, 1_000, HOST_CADENCE_GATE);
		const metadata = yield* remote.metadata;
		const otlpAfter = yield* remote.otlpOutputSizes;
		const result = {
			drill,
			metadata,
			otlpAfter,
			otlpBefore,
			hostGate: hostCadence,
			applicationGate: application,
			undecodableHostLines: host.undecodable,
			applicationSampleFailures: app.samples.filter(({ sample }) => sample === null).length,
		};
		yield* updateManifest(config, (manifest) => ({
			...manifest,
			preflight: result,
			watchdogDrill: drill[0] ?? null,
		}));
		yield* Effect.log("sandbox-resource-baseline.preflight", {
			hostPassed: hostCadence.passed,
			applicationPassed: application.passed,
			hostViolations: hostCadence.violations,
			applicationViolations: application.violations,
		});
		return result;
	});

const runScenarioSeries = (
	config: DriverConfig,
	invocationId: string,
	scenarios: ReadonlyArray<{
		readonly scenario: ScenarioDefinition;
		readonly plan: RepetitionPlan;
	}>,
) =>
	Effect.gen(function* () {
		const { context } = yield* makeContext(config, invocationId);
		const artifacts: ScenarioArtifact[] = [];
		for (const entry of scenarios) {
			const artifact = yield* runFreshRepetition(context, entry.scenario, entry.plan);
			yield* persistArtifact(config, artifact);
			artifacts.push(artifact);
			if (artifact.outcome === "aborted") {
				yield* Effect.log("sandbox-resource-baseline.stopped", {
					stopReason: artifact.stopReason,
					scenarioId: artifact.scenarioId,
				});
				break;
			}
		}
		return artifacts;
	});

const matrixPlan = (
	scenarioFor: (concurrency: number) => ScenarioDefinition,
	rounds: number,
	profileToken: (scenarioId: string, repetition: number) => string | null = () => null,
) => {
	const orders = counterbalancedOrder([...CONCURRENCY_CANDIDATES], rounds);
	const repetitions = new Map<string, number>();
	return orders.flatMap((order, roundIndex) =>
		order.map((concurrency, position) => {
			const scenario = scenarioFor(concurrency);
			const repetition = (repetitions.get(scenario.id) ?? 0) + 1;
			repetitions.set(scenario.id, repetition);
			return {
				scenario,
				plan: {
					notes: [],
					repetition,
					round: roundIndex + 1,
					orderInRound: position + 1,
					profileToken: profileToken(scenario.id, repetition),
				},
			};
		}),
	);
};

class DeploymentMismatchError extends Data.TaggedError("DeploymentMismatchError")<{
	readonly expected: string;
	readonly actual: string | null;
}> {}

const optionalEnv = (name: string) => {
	const value = process.env[name];
	return value === undefined || value.trim() === "" ? null : value.trim();
};

const prNumber = optionalEnv("BENCHMARK_PR_NUMBER");
const command = process.argv[2] ?? "help";
const config = readDriverConfig(process.env);
process.env["E2E_API_URL"] = config.apiUrl;
process.env["E2E_FRONTEND_URL"] = config.frontendUrl;
process.env["E2E_ADMIN_ACCESS_TOKEN"] = config.adminAccessToken;

const invocationId = `${command}-${randomUUID().slice(0, 8)}`;

const recordsInvocation = command !== "setup" && command !== "init";

/**
 * Captured so the failure handler below can close out the invocation it opened. A phase that dies
 * mid-flight would otherwise stay `running` in the manifest forever, which is how the first
 * `preflight` of run `2026-09-22T01-30-37Z` came to look like it was still in progress after the
 * process had exited.
 */
let startedAtUtc: string | null = null;

const program = Effect.gen(function* () {
	yield* Effect.promise(() =>
		mkdir(join(config.rawDirectory, "scenarios"), { mode: 0o700, recursive: true }),
	);
	startedAtUtc = yield* isoNow;
	if (recordsInvocation) {
		yield* recordInvocation(config, {
			command,
			startedAtUtc,
			invocationId,
			scenarioIds: [],
			stopReason: null,
			outcome: "running",
			completedAtUtc: null,
		});
	}
	switch (command) {
		case "init": {
			const paths = artifactPaths(config.outputDirectory);
			yield* writeArtifact(RunManifest, paths.manifestPath, {
				host: {},
				branch: null,
				startedAtUtc,
				prNumber: null,
				teardown: null,
				deviations: [],
				preflight: null,
				invocations: [],
				schemaVersion: 2,
				runId: config.runId,
				watchdogDrill: null,
				completedAtUtc: null,
				constituentRunIds: [config.runId],
				runtime: { bunVersion: null, denoVersion: null, effectVersion: null },
				commits: { ciTrigger: null, implementation: null, workflowRunUrl: null },
				profiles: { rawDeleted: null, verifiedAtUtc: null, remainingRawEntries: null },
				image: { tag: null, ociRevision: null, architecture: null, digest: config.imageDigest },
				deployment: { resourceSettings: {}, otelCollectorImage: null, redactedComposeSha256: null },
				retentionTolerance: {
					postGcGrowthRatio: 0.1,
					slopeBytesPerThousandOperations: 104_857_600,
				},
				counterbalancedOrders: {
					live: counterbalancedOrder([...CONCURRENCY_CANDIDATES], 3),
					hermetic: counterbalancedOrder([...CONCURRENCY_CANDIDATES], 5),
				},
				sampling: {
					hostIntervalMs: 1_000,
					applicationIntervalMs: 200,
					hostGate: { ...HOST_CADENCE_GATE },
					applicationGate: { ...APPLICATION_CADENCE_GATE },
				},
			});
			break;
		}
		case "provenance": {
			const remote = makeRemote(config.serverIp);
			const [deployment, sample] = yield* Effect.all([
				remote.deploymentProvenance,
				sampleRuntime(),
			]);
			if (config.imageDigest !== null && deployment.image.digest !== config.imageDigest) {
				return yield* new DeploymentMismatchError({
					expected: config.imageDigest,
					actual: deployment.image.digest,
				});
			}
			yield* updateManifest(config, (manifest) => ({
				...manifest,
				image: deployment.image,
				branch: optionalEnv("BENCHMARK_BRANCH"),
				host: { ...manifest.host, ...deployment.resourceSettings },
				prNumber: prNumber === null ? null : Number.parseInt(prNumber, 10),
				runtime: {
					bunVersion: sample.runtime.bunVersion,
					denoVersion: sample.runtime.denoVersion,
					effectVersion: optionalEnv("BENCHMARK_EFFECT_VERSION"),
				},
				commits: {
					ciTrigger: optionalEnv("BENCHMARK_CI_TRIGGER_COMMIT"),
					workflowRunUrl: optionalEnv("BENCHMARK_WORKFLOW_RUN_URL"),
					implementation: optionalEnv("BENCHMARK_IMPLEMENTATION_COMMIT"),
				},
				deployment: {
					redactedComposeSha256: deployment.composeSha256,
					otelCollectorImage: deployment.otelCollectorImage,
					resourceSettings: {
						...deployment.resourceSettings,
						processMode: sample.configuration.processMode,
						workerConcurrency: String(sample.configuration.workerConcurrency),
						benchmarkProfilingEnabled: String(sample.configuration.benchmarkProfilingEnabled),
						schedulerDispatchersDisabled: String(sample.configuration.schedulerDispatchersDisabled),
					},
				},
			}));
			yield* Effect.log("sandbox-resource-baseline.provenance", {
				image: deployment.image,
				composeSha256: deployment.composeSha256,
				profiling: sample.configuration.benchmarkProfilingEnabled,
			});
			break;
		}
		case "setup":
			yield* setup(config);
			break;
		case "capture-fixture": {
			const remote = makeRemote(config.serverIp);
			yield* remote.stopWatchdog;
			yield* remote.stopRyot.pipe(Effect.ignore);
			yield* remote.captureFixture;
			yield* remote.recreateRyot({ workerConcurrency: 2, schedulerDispatchersDisabled: true });
			const healthy = yield* waitForHealth(config);
			yield* Effect.log("sandbox-resource-baseline.capture-fixture", { healthy });
			break;
		}
		case "capture-live-results": {
			const { context } = yield* makeContext(config, invocationId);
			yield* captureLiveResults(context);
			break;
		}
		case "preflight":
			yield* preflight(config, invocationId);
			break;
		case "teardown": {
			const { context } = yield* makeContext(config, invocationId);
			const teardown = yield* context.remote.teardown({
				removeSampleFiles: process.argv[3] === "--remove-samples",
			});
			yield* updateManifest(config, (manifest) => ({
				...manifest,
				teardown: teardown as Record<string, unknown>,
			}));
			yield* Effect.log("sandbox-resource-baseline.teardown", teardown);
			break;
		}
		case "idle":
			yield* runScenarioSeries(
				config,
				invocationId,
				IDLE_SCENARIOS.flatMap((scenario) =>
					Array.from({ length: scenario.repetitions }, (_unused, index) => ({
						scenario,
						plan: {
							notes: [],
							round: null,
							orderInRound: null,
							profileToken: null,
							repetition: index + 1,
						},
					})),
				),
			);
			break;
		case "hermetic":
			yield* runScenarioSeries(
				config,
				invocationId,
				matrixPlan((concurrency) => findScenario(hermeticScenarioId(concurrency)), 5),
			);
			break;
		case "live":
			yield* runScenarioSeries(
				config,
				invocationId,
				matrixPlan((concurrency) => findScenario(liveScenarioId(concurrency)), 3),
			);
			break;
		case "variance":
			yield* runScenarioSeries(
				config,
				invocationId,
				VARIANCE_SCENARIOS.map((scenario) => ({
					scenario,
					plan: { notes: [], round: null, repetition: 1, orderInRound: null, profileToken: null },
				})),
			);
			break;
		case "profiles": {
			const { context } = yield* makeContext(config, invocationId);
			const selected = process.argv[3];
			yield* runProfileScenarios(
				context,
				selected === undefined
					? PROFILE_SCENARIOS
					: PROFILE_SCENARIOS.filter(({ id }) => id === selected),
				(artifact) => persistArtifact(config, artifact),
			);
			break;
		}
		case "soak": {
			const { context } = yield* makeContext(config, invocationId);
			const scenario = findScenario(requirePresent(process.argv[3], "soak requires a scenario id"));
			const artifact = yield* runSoak(context, scenario, scenario.id);
			yield* persistArtifact(config, artifact);
			break;
		}
		default:
			yield* Effect.log("sandbox-resource-baseline.usage", {
				live: LIVE_SCENARIOS.map(({ id }) => id),
				soaks: SOAK_SCENARIOS.map(({ id }) => id),
				scenarios: ALL_SCENARIOS.map(({ id }) => id),
				hermetic: HERMETIC_SCENARIOS.map(({ id }) => id),
				commands: [
					"init",
					"setup",
					"provenance",
					"capture-fixture",
					"capture-live-results",
					"preflight",
					"idle",
					"hermetic",
					"live",
					"variance",
					"profiles",
					"soak",
					"teardown",
					"summarize",
				],
			});
	}
	if (recordsInvocation) {
		yield* recordInvocation(config, {
			command,
			startedAtUtc,
			invocationId,
			scenarioIds: [],
			stopReason: null,
			outcome: "completed",
			completedAtUtc: yield* isoNow,
		});
	}
	return undefined;
});

const recordFailure = (cause: Cause.Cause<unknown>) =>
	Effect.gen(function* () {
		if (!recordsInvocation || startedAtUtc === null) {
			return;
		}
		yield* recordInvocation(config, {
			command,
			startedAtUtc,
			invocationId,
			scenarioIds: [],
			outcome: "failed",
			completedAtUtc: yield* isoNow,
			stopReason: Cause.pretty(cause),
		});
	}).pipe(Effect.ignore);

await Effect.runPromise(program.pipe(Effect.tapCause(recordFailure))).catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
