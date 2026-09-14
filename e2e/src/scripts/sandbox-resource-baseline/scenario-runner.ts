import { readFile } from "node:fs/promises";

import type { SandboxProviderId, SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { Clock, Effect, Fiber, Schema } from "effect";

import {
	adminHeaders,
	type Client,
	enqueueSandboxScript,
	getApiClient,
	sampleSandboxRuntime,
} from "~/fixtures/kernel";
import { pollSandboxJobResult, type RuntimeSample } from "~/support/benchmark-workload";

import {
	HostSample,
	identifierDigest,
	type ScenarioArtifact,
	type ScenarioRequest,
} from "./artifacts";
import type { DriverConfig } from "./config";
import type { ScenarioDefinition } from "./scenarios";
import { summarizeScenario } from "./statistics";
import {
	type BenchmarkWorkloadContext,
	encodeBenchmarkExternalId,
	TYPED_FAILURE_MESSAGE,
} from "./workload-sources";

export type ScenarioContext = {
	readonly runId: string;
	readonly userId: string;
	readonly client: Client;
	readonly config: DriverConfig;
	readonly scriptId: SandboxScriptId;
	readonly bookProviderId: SandboxProviderId;
};

type RawScenarioRequest = ScenarioRequest & { readonly executionId: string | null };

export type ScenarioRun = {
	readonly artifact: ScenarioArtifact;
	readonly rawRequests: ReadonlyArray<RawScenarioRequest>;
};

const nonce = (parts: ReadonlyArray<string | number>) =>
	parts.join("-").replace(/[^A-Za-z0-9-]/g, "-");

const boundedMessage = (message: string) =>
	message.includes(TYPED_FAILURE_MESSAGE) ? TYPED_FAILURE_MESSAGE : null;

const startSampling = (intervalMs: number) =>
	Effect.gen(function* () {
		const samples: RuntimeSample[] = [];
		const fiber = yield* Effect.gen(function* () {
			const sample = yield* sampleSandboxRuntime.pipe(
				Effect.catchCause(() => Effect.succeed(null)),
			);
			if (sample !== null) {
				samples.push(sample);
			}
			yield* Effect.sleep(`${intervalMs} millis`);
		}).pipe(Effect.forever, Effect.forkScoped);
		return { samples, stop: Fiber.interrupt(fiber) };
	});

const runDirectRequest = (
	context: ScenarioContext,
	workload: BenchmarkWorkloadContext,
	index: number,
) =>
	Effect.gen(function* () {
		const startedAtMs = yield* Clock.currentTimeMillis;
		const enqueued = yield* enqueueSandboxScript(context.userId, {
			scriptId: context.scriptId,
			context: { ...workload, seed: workload.seed * 1_000 + index },
		});
		const result = yield* pollSandboxJobResult(context.userId, enqueued.jobId, 200);
		const terminalAtMs = yield* Clock.currentTimeMillis;
		const failed = result.status === "failed" || result.error !== null;
		return {
			index,
			startedAtMs,
			terminalAtMs,
			executionId: enqueued.executionId,
			latencyMs: terminalAtMs - startedAtMs,
			executionIdDigest: identifierDigest(enqueued.executionId),
			outcome: failed ? ("failed" as const) : ("completed" as const),
			failureStage: result.status === "completed" ? (result.error?.phase ?? null) : "dispatch",
			responseByteLength:
				result.status === "completed" ? JSON.stringify(result.value ?? null).length : null,
			failureCode:
				result.status === "failed"
					? boundedMessage(result.error)
					: boundedMessage(result.error?.message ?? ""),
		} satisfies RawScenarioRequest;
	});

const pollImportResult = (context: ScenarioContext, jobId: string) =>
	Effect.gen(function* () {
		for (;;) {
			const result = yield* context.client.call((client) =>
				client.providerEntities.getImportResult({ params: { jobId } }),
			);
			if (result.status !== "pending") {
				return result;
			}
			yield* Effect.sleep("200 millis");
		}
	});

const runImportRequest = (
	context: ScenarioContext,
	input: {
		readonly index: number;
		readonly externalId: string;
		readonly providerId: SandboxProviderId;
	},
) =>
	Effect.gen(function* () {
		const startedAtMs = yield* Clock.currentTimeMillis;
		const { jobId } = yield* context.client.call((client) =>
			client.providerEntities.import({
				payload: { externalId: input.externalId, providerId: input.providerId },
			}),
		);
		const result = yield* pollImportResult(context, jobId);
		const terminalAtMs = yield* Clock.currentTimeMillis;
		return {
			startedAtMs,
			terminalAtMs,
			failureCode: null,
			executionId: null,
			index: input.index,
			responseByteLength: null,
			latencyMs: terminalAtMs - startedAtMs,
			executionIdDigest: identifierDigest(jobId),
			failureStage: result.status === "failed" ? result.reason.stage : null,
			outcome: result.status === "completed" ? ("completed" as const) : ("failed" as const),
		} satisfies RawScenarioRequest;
	});

/** The shipped provider is resolved through its details script slug, `<provider slug>.details`. */
const resolveLiveProvider = (scenario: ScenarioDefinition) =>
	Effect.gen(function* () {
		const search = scenario.liveSearch;
		if (search === null) {
			return null;
		}
		const scripts = yield* getApiClient().call(
			(client) => client.testSupport.listSandboxScripts({ query: {} }),
			adminHeaders(),
		);
		const details = scripts.find((script) => script.slug === `${search.providerSlug}.details`);
		return details?.providerId ?? null;
	});

const submitWorkload = (
	context: ScenarioContext,
	scenario: ScenarioDefinition,
	repetition: number,
) =>
	Effect.gen(function* () {
		if (scenario.kind === "idle") {
			yield* Effect.sleep(`${scenario.idleDurationMs} millis`);
			return [] as ReadonlyArray<RawScenarioRequest>;
		}
		if (scenario.kind === "direct") {
			return yield* Effect.all(
				Array.from({ length: scenario.concurrency }, (_unused, index) =>
					runDirectRequest(context, scenario.workload, index),
				),
				{ concurrency: "unbounded" },
			);
		}
		if (scenario.kind === "live-import") {
			const providerId = yield* resolveLiveProvider(scenario);
			const search = scenario.liveSearch;
			if (providerId === null || search === null) {
				return [] as ReadonlyArray<RawScenarioRequest>;
			}
			const found = yield* context.client.call((client) =>
				client.providerEntities.search({
					payload: { page: 1, providerId, query: search.query, pageSize: search.pageSize },
				}),
			);
			return yield* Effect.forEach(
				found.items.slice(0, scenario.concurrency),
				(item, index) =>
					runImportRequest(context, { index, providerId, externalId: item.externalId }),
				{ concurrency: "unbounded" },
			);
		}
		return yield* Effect.all(
			Array.from({ length: scenario.concurrency }, (_unused, index) =>
				runImportRequest(context, {
					index,
					providerId: context.bookProviderId,
					externalId: encodeBenchmarkExternalId({
						...scenario.workload,
						nonce: nonce([context.runId, scenario.id, repetition, index]),
					}),
				}),
			),
			{ concurrency: "unbounded" },
		);
	});

/** Group E pauses here until the operator restarts only the Ryot container. */
const waitForActiveWorkers = (target: number, timeoutMs: number) =>
	Effect.gen(function* () {
		const deadline = (yield* Clock.currentTimeMillis) + timeoutMs;
		for (;;) {
			const sample = yield* sampleSandboxRuntime;
			if (sample.workers.length >= target) {
				return true;
			}
			if ((yield* Clock.currentTimeMillis) >= deadline) {
				return false;
			}
			yield* Effect.sleep("200 millis");
		}
	});

export const waitForStableBackendRss = (config: DriverConfig) =>
	Effect.gen(function* () {
		const intervalMs = 5_000;
		const windowSize = Math.max(2, Math.ceil(config.stabilization.windowMs / intervalMs));
		const deadline = (yield* Clock.currentTimeMillis) + config.stabilization.maxWaitMs;
		const window: number[] = [];
		for (;;) {
			const sample = yield* sampleSandboxRuntime;
			window.push(sample.backend.rssBytes);
			if (window.length > windowSize) {
				window.shift();
			}
			const lowest = Math.min(...window);
			const drift = lowest === 0 ? 1 : (Math.max(...window) - lowest) / lowest;
			if (window.length === windowSize && drift < config.stabilization.maxDriftRatio) {
				return { stable: true, driftRatio: drift };
			}
			if ((yield* Clock.currentTimeMillis) >= deadline) {
				return { stable: false, driftRatio: drift };
			}
			yield* Effect.sleep(`${intervalMs} millis`);
		}
	});

const readHostSamples = (path: string | null, fromMs: number, toMs: number) =>
	path === null
		? Effect.succeed([] as ReadonlyArray<typeof HostSample.Type>)
		: Effect.tryPromise(() => readFile(path, "utf8")).pipe(
				Effect.map((contents) =>
					contents
						.split("\n")
						.filter((line) => line.trim() !== "")
						.flatMap((line) => {
							const parsed = Schema.decodeSync(Schema.fromJsonString(HostSample))(line);
							const timestampMs = Number(parsed["timestampMs"] ?? 0);
							return timestampMs >= fromMs && timestampMs <= toMs ? [parsed] : [];
						}),
				),
				Effect.catchCause(() => Effect.succeed([] as ReadonlyArray<typeof HostSample.Type>)),
			);

const restartOffsetMs = (samples: ReadonlyArray<RuntimeSample>) => {
	const first = samples[0];
	if (first === undefined) {
		return null;
	}
	for (let index = 1; index < samples.length; index += 1) {
		const previous = samples[index - 1];
		const current = samples[index];
		if (
			previous !== undefined &&
			current !== undefined &&
			current.totalSpawned < previous.totalSpawned
		) {
			return current.timestampMs - first.timestampMs;
		}
	}
	return null;
};

const stopReasonFor = (input: { readonly timedOut: boolean; readonly oomKilled: boolean }) => {
	if (input.timedOut) {
		return "request-timeout";
	}
	return input.oomKilled ? "cgroup-oom-kill" : null;
};

const scenarioOutcomeFor = (input: {
	readonly stopReason: string | null;
	readonly requests: ReadonlyArray<RawScenarioRequest>;
}): ScenarioArtifact["outcome"] => {
	if (input.stopReason !== null) {
		return "aborted";
	}
	return input.requests.some(({ outcome }) => outcome !== "completed") ? "failed" : "completed";
};

const oomKillObserved = (samples: ReadonlyArray<RuntimeSample>) => {
	const first = samples.find((sample) => sample.cgroup !== null)?.cgroup ?? null;
	const last = [...samples].toReversed().find((sample) => sample.cgroup !== null)?.cgroup ?? null;
	return first !== null && last !== null && last.events.oomKill > first.events.oomKill;
};

export const runScenarioRepetition = (
	context: ScenarioContext,
	scenario: ScenarioDefinition,
	repetition: number,
): Effect.Effect<ScenarioRun, unknown> =>
	Effect.scoped(
		Effect.gen(function* () {
			const preScenarioSample = yield* sampleSandboxRuntime;
			const { stop, samples } = yield* startSampling(context.config.sampleIntervalMs);
			const startedAtMs = yield* Clock.currentTimeMillis;
			if (scenario.awaitActiveWorkers !== null) {
				yield* waitForActiveWorkers(
					scenario.awaitActiveWorkers,
					context.config.requestTimeoutMs,
				).pipe(
					Effect.flatMap((reached) =>
						Effect.log("sandbox-resource-baseline.restart-window", {
							reached,
							scenarioId: scenario.id,
							requiresManualRestart: scenario.requiresManualRestart,
						}),
					),
					Effect.forkScoped,
				);
			}
			const submittedAtMs = yield* Clock.currentTimeMillis;
			const outcome = yield* submitWorkload(context, scenario, repetition).pipe(
				Effect.timeoutOrElse({
					orElse: () => Effect.succeed(null),
					duration: `${context.config.requestTimeoutMs} millis`,
				}),
			);
			const requests = outcome ?? [];
			const terminalAtMs = yield* Clock.currentTimeMillis;
			yield* Effect.sleep(`${context.config.recoveryWindowMs} millis`);
			yield* stop;
			const completedAtMs = yield* Clock.currentTimeMillis;
			const hostSamples = yield* readHostSamples(
				context.config.hostSampleFile,
				startedAtMs,
				completedAtMs,
			);
			const oomKilled = oomKillObserved(samples);
			const stopReason = stopReasonFor({ oomKilled, timedOut: outcome === null });
			const artifact: ScenarioArtifact = {
				repetition,
				stopReason,
				startedAtMs,
				hostSamples,
				terminalAtMs,
				submittedAtMs,
				completedAtMs,
				runId: context.runId,
				scenarioId: scenario.id,
				configuration: scenario,
				applicationSamples: samples,
				restartDetectedAfterMs: restartOffsetMs(samples),
				outcome: scenarioOutcomeFor({ requests, stopReason }),
				statistics: summarizeScenario({ samples, terminalAtMs, preScenarioSample }),
				requests: requests.map(({ executionId: _executionId, ...request }) => request),
			};
			return { artifact, rawRequests: requests };
		}),
	);
