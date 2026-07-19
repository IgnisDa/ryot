import {
	type SandboxProviderId,
	type SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Clock, Data, Effect } from "effect";

import type { ContractSession } from "~/fixtures/kernel";
import { adminHeaders, getApiClient, makeSession, signInWithPassword } from "~/fixtures/kernel";
import { requirePresent } from "~/support/assertions";

import {
	type AppAuxLine,
	appRecord,
	type AppSampleLine,
	completedWorkers,
	decodeAppLines,
	healthPings,
	pressurePoints,
	type RuntimeSample,
} from "./app-samples";
import {
	identifierDigest,
	type ScenarioArtifact,
	type ScenarioOutcome,
	type ScenarioRequest,
} from "./artifacts";
import { type CadenceRecord, cadenceStatistics } from "./cadence";
import type { DriverConfig } from "./config";
import type { HostSampleLine } from "./host/samples";
import { type Remote, REMOTE_FILES } from "./ops";
import { accountImports, type ImportRecord, type PhaseSegment, summarizePhases } from "./phases";
import type { ScenarioDefinition } from "./scenarios";
import {
	type AppRecord,
	appPoint,
	type CompletedWorkerRecord,
	downsample,
	executionTimings,
	hostPoint,
	repetitionMetrics,
	workerLifecycle,
} from "./statistics";
import { type BenchmarkWorkloadContext, encodeBenchmarkExternalId } from "./workload-sources";

export type DriverState = {
	readonly liveExternalIds: ReadonlyArray<string>;
	readonly email: string;
	readonly userId: string;
	readonly password: string;
	readonly pluginSlug: string;
	readonly scriptId: SandboxScriptId;
	readonly bookProviderId: SandboxProviderId;
	readonly youtubeMusic: {
		readonly providerId: SandboxProviderId;
		readonly detailsScriptId: SandboxScriptId;
	};
};

export type RunContext = {
	readonly runId: string;
	readonly remote: Remote;
	readonly state: DriverState;
	readonly config: DriverConfig;
	readonly invocationId: string;
	readonly session: ContractSession;
};

const POLL_INTERVAL_MS = 1_000;

export class ScenarioPreparationError extends Data.TaggedError("ScenarioPreparationError")<{
	readonly message: string;
}> {}

const isUnauthorized = (error: unknown) =>
	typeof error === "object" &&
	error !== null &&
	"_tag" in error &&
	error._tag === "AuthUnauthorized";

/** The OAuth access token expires inside long scenarios, so an unauthorized call signs in again. */
export const resilientSession = (email: string, password: string) =>
	Effect.map(
		Effect.map(signInWithPassword(email, password), (signIn) =>
			makeSession(undefined, {
				Authorization: `Bearer ${requirePresent(signIn.token, "benchmark sign-in returned no token")}`,
			}),
		),
		(initial): ContractSession => {
			let session = initial;
			return {
				call: (program, headers) =>
					session.call(program, headers).pipe(
						Effect.catchIf(isUnauthorized, () =>
							Effect.flatMap(resilientSession(email, password), (next) => {
								session = next;
								return next.call(program, headers);
							}),
						),
					),
			};
		},
	);

export const sampleRuntime = (options: { readonly includeSmaps?: boolean } = {}) =>
	getApiClient().call(
		(client) =>
			client.testSupport.sampleSandboxRuntime({
				query: options.includeSmaps === true ? { includeSmaps: "true" } : {},
			}),
		adminHeaders(),
	);

export const waitForHealth = (config: DriverConfig, timeoutMs = 300_000) =>
	Effect.gen(function* () {
		const deadline = (yield* Clock.currentTimeMillis) + timeoutMs;
		for (;;) {
			const healthy = yield* Effect.tryPromise(async () => {
				const response = await fetch(`${config.apiUrl}/system/health`, {
					signal: AbortSignal.timeout(10_000),
				});
				return response.status === 200;
			}).pipe(Effect.orElseSucceed(() => false));
			if (healthy) {
				return true;
			}
			if ((yield* Clock.currentTimeMillis) >= deadline) {
				return false;
			}
			yield* Effect.sleep("2 seconds");
		}
	});

export const waitForStableBackendRss = (config: DriverConfig) =>
	Effect.gen(function* () {
		const intervalMs = 5_000;
		const windowSize = Math.max(2, Math.ceil(config.stabilization.windowMs / intervalMs));
		const deadline = (yield* Clock.currentTimeMillis) + config.stabilization.maxWaitMs;
		const window: number[] = [];
		for (;;) {
			const sample = yield* sampleRuntime();
			window.push(sample.backend.rssBytes);
			if (window.length > windowSize) {
				window.shift();
			}
			const lowest = Math.min(...window);
			const drift = lowest === 0 ? 1 : (Math.max(...window) - lowest) / lowest;
			if (window.length === windowSize && drift < config.stabilization.maxDriftRatio) {
				return { waitedMs: 0, stable: true, driftRatio: drift };
			}
			if ((yield* Clock.currentTimeMillis) >= deadline) {
				return { stable: false, driftRatio: drift, waitedMs: config.stabilization.maxWaitMs };
			}
			yield* Effect.sleep(`${intervalMs} millis`);
		}
	});

/**
 * Restores the fixture database while Ryot is stopped, recreates only the Ryot container with the
 * scenario's settings, and waits for a stable fresh process.
 */
export const prepareFreshProcess = (context: RunContext, scenario: ScenarioDefinition) =>
	Effect.gen(function* () {
		yield* context.remote.stopWatchdog;
		yield* context.remote.stopRyot.pipe(Effect.ignore);
		yield* context.remote.restoreFixture;
		yield* context.remote.recreateRyot({
			workerConcurrency: scenario.workerConcurrency,
			schedulerDispatchersDisabled: scenario.schedulerDispatchersDisabled,
		});
		const healthy = yield* waitForHealth(context.config);
		if (!healthy) {
			return yield* new ScenarioPreparationError({
				message: "Ryot did not become healthy after recreation",
			});
		}
		yield* context.remote.startWatchdog;
		const sample = yield* sampleRuntime();
		if (sample.configuration.workerConcurrency !== scenario.workerConcurrency) {
			return yield* new ScenarioPreparationError({
				message: `effective worker concurrency ${sample.configuration.workerConcurrency} does not match scenario ${scenario.workerConcurrency}`,
			});
		}
		const stabilization = yield* waitForStableBackendRss(context.config);
		return { sample, stabilization };
	});

const directRequest = (
	context: RunContext,
	input: {
		readonly wave: number;
		readonly index: number;
		readonly scriptId: SandboxScriptId;
		readonly executionContext: unknown;
	},
) =>
	Effect.gen(function* () {
		const startedAtMs = yield* Clock.currentTimeMillis;
		const enqueued = yield* getApiClient().call(
			(client) =>
				client.testSupport.enqueueSandbox({
					payload: {
						scriptId: input.scriptId,
						context: input.executionContext,
						executingUserId: UserId.make(context.state.userId),
					},
				}),
			adminHeaders(),
		);
		const jobId = requirePresent(enqueued.jobId, "sandbox enqueue returned no job id");
		const result = yield* pollSandboxResult(context, jobId);
		const terminalAtMs = yield* Clock.currentTimeMillis;
		const failed = result.status === "failed" || result.error !== null;
		return {
			startedAtMs,
			terminalAtMs,
			attempts: null,
			wave: input.wave,
			queueWaitMs: null,
			executionMs: null,
			index: input.index,
			executionKey: enqueued.executionId,
			latencyMs: terminalAtMs - startedAtMs,
			identityDigest: identifierDigest(enqueued.executionId),
			outcome: failed ? ("failed" as const) : ("completed" as const),
			failureCode: result.status === "failed" ? "failed" : (result.error?.kind ?? null),
			failureStage: result.status === "completed" ? (result.error?.phase ?? null) : "dispatch",
			responseByteLength:
				result.status === "completed" ? JSON.stringify(result.value ?? null).length : null,
		};
	});

const pollSandboxResult = (context: RunContext, jobId: string) =>
	Effect.gen(function* () {
		for (;;) {
			const result = yield* getApiClient().call(
				(client) =>
					client.testSupport.getSandboxResult({
						params: { jobId },
						query: { executingUserId: UserId.make(context.state.userId) },
					}),
				adminHeaders(),
			);
			if (result.status !== "pending") {
				return result;
			}
			yield* Effect.sleep(`${POLL_INTERVAL_MS} millis`);
		}
	});

const isTransientApiFailure = (error: unknown) =>
	typeof error === "object" &&
	error !== null &&
	"_tag" in error &&
	error._tag === "HttpClientError";

const importRequest = (
	context: RunContext,
	input: {
		readonly wave: number;
		readonly index: number;
		readonly externalId: string;
		readonly providerId: SandboxProviderId;
		readonly record: (record: ImportRecord) => void;
	},
) =>
	Effect.gen(function* () {
		const startedAtMs = yield* Clock.currentTimeMillis;
		const { jobId } = yield* context.session.call((client) =>
			client.providerEntities.import({
				payload: { externalId: input.externalId, providerId: input.providerId },
			}),
		);
		input.record({
			jobId,
			startedAtMs,
			outcome: null,
			terminalAtMs: null,
			failureStage: null,
			submittedAtMs: startedAtMs,
		} as ImportRecord);
		for (;;) {
			const result = yield* context.session
				.call((client) => client.providerEntities.getImportResult({ params: { jobId } }))
				.pipe(
					Effect.map((value) => ({ value })),
					Effect.catchIf(isTransientApiFailure, () => Effect.succeed(null)),
				);
			if (result !== null && result.value.status !== "pending") {
				const terminalAtMs = yield* Clock.currentTimeMillis;
				const completed = result.value.status === "completed";
				const failureStage = result.value.status === "failed" ? result.value.reason.stage : null;
				input.record({
					jobId,
					failureStage,
					terminalAtMs,
					submittedAtMs: startedAtMs,
					outcome: completed ? "completed" : "failed",
				});
				return {
					startedAtMs,
					terminalAtMs,
					failureStage,
					attempts: null,
					wave: input.wave,
					queueWaitMs: null,
					executionMs: null,
					failureCode: null,
					index: input.index,
					executionKey: null,
					responseByteLength: null,
					latencyMs: terminalAtMs - startedAtMs,
					identityDigest: identifierDigest(jobId),
					outcome: completed ? ("completed" as const) : ("failed" as const),
				};
			}
			yield* Effect.sleep(`${POLL_INTERVAL_MS} millis`);
		}
	});

/** One measured search, returned as its own request record with the external ids it found. */
export const liveSearchRequest = (
	context: RunContext,
	search: { readonly pageSize: number; readonly query: string },
) =>
	Effect.gen(function* () {
		const startedAtMs = yield* Clock.currentTimeMillis;
		const found = yield* searchYoutubeMusic(context, search.pageSize, search.query);
		const terminalAtMs = yield* Clock.currentTimeMillis;
		return {
			externalIds: found.items.map(({ externalId }) => externalId),
			request: {
				wave: 0,
				index: -1,
				startedAtMs,
				terminalAtMs,
				attempts: null,
				failureCode: null,
				queueWaitMs: null,
				executionMs: null,
				executionKey: null,
				failureStage: null,
				identityDigest: null,
				latencyMs: terminalAtMs - startedAtMs,
				responseByteLength: found.items.length,
				outcome:
					found.items.length === search.pageSize ? ("completed" as const) : ("failed" as const),
			},
		};
	});

export const searchYoutubeMusic = (context: RunContext, pageSize: number, query: string) =>
	context.session.call((client) =>
		client.providerEntities.search({
			payload: { query, page: 1, pageSize, providerId: context.state.youtubeMusic.providerId },
		}),
	);

type SubmissionResult = {
	readonly requests: ReadonlyArray<ScenarioRequest & { readonly executionKey: string | null }>;
	readonly importRecords: ReadonlyArray<ImportRecord>;
};

export const submitWave = (
	context: RunContext,
	scenario: ScenarioDefinition,
	input: {
		readonly wave: number;
		readonly nonce: string;
		readonly liveExternalIds: ReadonlyArray<string>;
		readonly workload: BenchmarkWorkloadContext | null;
		readonly idleAfterSubmitMs?: number;
	},
): Effect.Effect<SubmissionResult, unknown> =>
	Effect.gen(function* () {
		const idleMs = input.idleAfterSubmitMs ?? 0;
		if (idleMs > 0) {
			yield* Effect.sleep(`${idleMs} millis`);
		}
		const importRecords: ImportRecord[] = [];
		const record = (entry: ImportRecord) => importRecords.push(entry);
		const indexes = Array.from({ length: scenario.requestCount }, (_unused, index) => index);
		const concurrency = scenario.sequential ? 1 : "unbounded";
		const workload = input.workload;
		if (scenario.submission === "none") {
			return { requests: [], importRecords };
		}
		if (scenario.submission === "direct" && workload !== null) {
			const requests = yield* Effect.forEach(
				indexes,
				(index) =>
					directRequest(context, {
						index,
						wave: input.wave,
						scriptId: context.state.scriptId,
						executionContext: { ...workload, seed: workload.seed * 1_000 + index },
					}),
				{ concurrency },
			);
			return { requests, importRecords };
		}
		if (scenario.submission === "import" && workload !== null) {
			const requests = yield* Effect.forEach(
				indexes,
				(index) =>
					importRequest(context, {
						index,
						record,
						wave: input.wave,
						providerId: context.state.bookProviderId,
						externalId: encodeBenchmarkExternalId({
							...workload,
							nonce: `${input.nonce}-${index}`,
						}),
					}),
				{ concurrency },
			);
			return { requests, importRecords };
		}
		if (scenario.submission === "live-search") {
			const search = requirePresent(scenario.liveSearch, "live search configuration is required");
			const requests = yield* Effect.forEach(
				indexes,
				(index) =>
					Effect.gen(function* () {
						const startedAtMs = yield* Clock.currentTimeMillis;
						const found = yield* searchYoutubeMusic(context, search.pageSize, search.query);
						const terminalAtMs = yield* Clock.currentTimeMillis;
						return {
							index,
							startedAtMs,
							terminalAtMs,
							attempts: null,
							wave: input.wave,
							queueWaitMs: null,
							executionMs: null,
							failureCode: null,
							failureStage: null,
							executionKey: null,
							identityDigest: null,
							latencyMs: terminalAtMs - startedAtMs,
							responseByteLength: found.items.length,
							outcome:
								found.items.length === search.pageSize
									? ("completed" as const)
									: ("failed" as const),
						};
					}),
				{ concurrency: 1 },
			);
			return { requests, importRecords };
		}
		if (scenario.submission === "live-details") {
			const requests = yield* Effect.forEach(
				indexes,
				(index) =>
					directRequest(context, {
						index,
						wave: input.wave,
						scriptId: context.state.youtubeMusic.detailsScriptId,
						executionContext: {
							externalId: requirePresent(
								input.liveExternalIds[index % Math.max(1, input.liveExternalIds.length)],
								"live external id is required",
							),
						},
					}),
				{ concurrency },
			);
			return { requests, importRecords };
		}
		const requests = yield* Effect.forEach(
			input.liveExternalIds.slice(0, scenario.requestCount),
			(externalId, index) =>
				importRequest(context, {
					index,
					record,
					externalId,
					wave: input.wave,
					providerId: context.state.youtubeMusic.providerId,
				}),
			{ concurrency },
		);
		return { requests, importRecords };
	});

export const listPhaseSegments = (afterSequence: number) =>
	getApiClient()
		.call(
			(client) => client.testSupport.listProviderImportPhaseSegments({ query: { afterSequence } }),
			adminHeaders(),
		)
		.pipe(Effect.map(({ segments }) => segments as ReadonlyArray<PhaseSegment>));

export type CaptureInput = {
	readonly round: number | null;
	readonly repetition: number;
	readonly orderInRound: number | null;
	readonly preSample: RuntimeSample;
	readonly startedAtMs: number;
	readonly submittedAtMs: number;
	readonly terminalAtMs: number;
	readonly completedAtMs: number;
	readonly appOffset: number;
	readonly hostOffset: number;
	readonly phaseSequence: number;
	readonly peakReset: { readonly supported: boolean; readonly verified: boolean } | null;
	readonly containersBefore: ReadonlyArray<Record<string, unknown>>;
	readonly requests: ReadonlyArray<ScenarioRequest & { readonly executionKey: string | null }>;
	readonly importRecords: ReadonlyArray<ImportRecord>;
	readonly waves: ScenarioArtifact["waves"];
	readonly profileIds: ReadonlyArray<string>;
	readonly notes: ReadonlyArray<string>;
	readonly sources?: CaptureSources;
};

const asRecords = (lines: ReadonlyArray<AppSampleLine>): AppRecord[] =>
	lines.flatMap((line) => (line.sample === null ? [] : [appRecord(line.sample, line.startedMs)]));

export type CaptureSources = {
	readonly records: ReadonlyArray<AppRecord>;
	readonly aux: ReadonlyArray<AppAuxLine>;
	readonly hostSamples: ReadonlyArray<HostSampleLine>;
	readonly completedWorkers: ReadonlyArray<CompletedWorkerRecord>;
	readonly undecodableHostLines: number;
	readonly applicationSampleFailures: number;
	readonly applicationCadence: ReadonlyArray<CadenceRecord>;
	readonly hostCadence: ReadonlyArray<CadenceRecord>;
};

/** Reads everything appended to the remote sample files since the repetition started. */
export const readSources = (
	remote: Remote,
	offsets: { readonly appOffset: number; readonly hostOffset: number },
): Effect.Effect<CaptureSources, unknown> =>
	Effect.gen(function* () {
		const [appOutput, hostOutput] = yield* Effect.all([
			remote.readAppended(REMOTE_FILES.appSamples, offsets.appOffset),
			remote.readAppended(REMOTE_FILES.hostSamples, offsets.hostOffset),
		]);
		const app = decodeAppLines(appOutput);
		const host = remote.decodeSamples(hostOutput);
		return {
			aux: app.aux,
			hostSamples: host.samples,
			hostCadence: host.samples,
			records: asRecords(app.samples),
			applicationCadence: app.samples,
			undecodableHostLines: host.undecodable,
			completedWorkers: completedWorkers(app.samples),
			applicationSampleFailures: app.samples.filter(({ sample }) => sample === null).length,
		};
	});

export const mergeSources = (left: CaptureSources, right: CaptureSources): CaptureSources => ({
	aux: [...left.aux, ...right.aux],
	records: [...left.records, ...right.records],
	hostSamples: [...left.hostSamples, ...right.hostSamples],
	hostCadence: [...left.hostCadence, ...right.hostCadence],
	undecodableHostLines: left.undecodableHostLines + right.undecodableHostLines,
	applicationCadence: [...left.applicationCadence, ...right.applicationCadence],
	applicationSampleFailures: left.applicationSampleFailures + right.applicationSampleFailures,
	completedWorkers: [
		...new Map(
			[...left.completedWorkers, ...right.completedWorkers].map((worker) => [
				worker.sequence,
				worker,
			]),
		).values(),
	].sort((first, second) => first.sequence - second.sequence),
});

export const emptySources: CaptureSources = {
	aux: [],
	records: [],
	hostSamples: [],
	hostCadence: [],
	completedWorkers: [],
	applicationCadence: [],
	undecodableHostLines: 0,
	applicationSampleFailures: 0,
};

/** Collects every window-bounded record source and derives the committed artifact. */
export const captureRepetition = (
	context: RunContext,
	scenario: ScenarioDefinition,
	input: CaptureInput,
): Effect.Effect<ScenarioArtifact, unknown> =>
	Effect.gen(function* () {
		const { remote } = context;
		const sources =
			input.sources ??
			(yield* readSources(remote, { appOffset: input.appOffset, hostOffset: input.hostOffset }));
		const containersAfter = yield* remote.metadata.pipe(Effect.map(({ containers }) => containers));
		const journal = yield* remote.journal(input.startedAtMs, input.completedAtMs);
		const triggers = yield* remote.watchdogTriggers;
		const segments = yield* listPhaseSegments(input.phaseSequence);
		const records = sources.records;
		const pre =
			records.findLast(({ t }) => t <= input.submittedAtMs) ??
			appRecord(input.preSample, input.submittedAtMs);
		const workers = sources.completedWorkers;
		const timings = executionTimings(
			workers,
			input.requests.flatMap((request) =>
				request.executionKey === null
					? []
					: [{ executionKey: request.executionKey, submittedAtMs: request.startedAtMs }],
			),
		);
		const requests = input.requests.map(({ executionKey, ...request }) => {
			const timing = executionKey === null ? undefined : timings.get(executionKey);
			return {
				...request,
				attempts: timing?.attempts ?? null,
				queueWaitMs: timing?.queueWaitMs ?? null,
				executionMs: timing?.executionMs ?? null,
			} satisfies ScenarioRequest;
		});
		const window = {
			terminalAtMs: input.terminalAtMs,
			submittedAtMs: input.submittedAtMs,
			completedAtMs: input.completedAtMs,
		};
		const lifecycle = workerLifecycle({
			pre,
			completedWorkers: workers,
			last: records.findLast(({ t }) => t <= input.completedAtMs) ?? pre,
			records: records.filter(({ t }) => t >= input.submittedAtMs && t <= input.completedAtMs),
		});
		const metrics = repetitionMetrics({
			pre,
			window,
			records,
			requests,
			completedWorkers: workers,
			host: sources.hostSamples,
			health: healthPings(sources.aux),
			pressure: pressurePoints(sources.aux),
		});
		const oomKilled =
			(metrics["ryot.cgroupOomKillDelta"] ?? 0) > 0 || (metrics["host.oomKillDelta"] ?? 0) > 0;
		const stopReason = ((): string | null => {
			if (triggers.length > 0) {
				return `watchdog:${triggers[0]?.reason}`;
			}
			return oomKilled ? "oom-kill" : null;
		})();
		const failed = requests.some(({ outcome }) => outcome !== "completed");
		const outcome: ScenarioOutcome = ((): ScenarioOutcome => {
			if (stopReason !== null) {
				return "aborted";
			}
			return failed ? "failed" : "completed";
		})();
		const imports = input.importRecords.length === 0 ? null : accountImports(input.importRecords);
		const scenarioSegments = segments.filter(
			({ startedAtMs }) => startedAtMs >= input.startedAtMs && startedAtMs <= input.completedAtMs,
		);
		return {
			imports,
			outcome,
			requests,
			stopReason,
			schemaVersion: 2,
			notes: input.notes,
			waves: input.waves,
			round: input.round,
			workers: lifecycle,
			runId: context.runId,
			configuration: scenario,
			scenarioId: scenario.id,
			peakReset: input.peakReset,
			profileIds: input.profileIds,
			repetition: input.repetition,
			orderInRound: input.orderInRound,
			invocationId: context.invocationId,
			watchdog: { triggers, triggered: triggers.length > 0 },
			phases: scenarioSegments.length === 0 ? null : summarizePhases(scenarioSegments),
			journal: { lines: journal.lines, lineCount: journal.lineCount, truncated: journal.truncated },
			metrics: {
				...metrics,
				"cadence.applicationSampleFailures": sources.applicationSampleFailures,
			},
			containers: {
				before: input.containersBefore,
				after: containersAfter as ReadonlyArray<Record<string, unknown>>,
			},
			series: {
				application: downsample(records.map(appPoint)),
				host: downsample(sources.hostSamples.map(hostPoint)),
			},
			timeline: {
				preScenarioAtMs: pre.t,
				startedAtMs: input.startedAtMs,
				terminalAtMs: input.terminalAtMs,
				submittedAtMs: input.submittedAtMs,
				completedAtMs: input.completedAtMs,
			},
			cadence: {
				undecodableHostLines: sources.undecodableHostLines,
				host: cadenceStatistics(sources.hostCadence, 1_000),
				applicationSampleFailures: sources.applicationSampleFailures,
				application: cadenceStatistics(sources.applicationCadence, 200),
			},
			effective: {
				imageDigest: context.config.imageDigest,
				bunVersion: input.preSample.runtime.bunVersion,
				denoVersion: input.preSample.runtime.denoVersion,
				processMode: input.preSample.configuration.processMode,
				workerConcurrency: input.preSample.configuration.workerConcurrency,
				benchmarkProfilingEnabled: input.preSample.configuration.benchmarkProfilingEnabled,
				schedulerDispatchersDisabled: input.preSample.configuration.schedulerDispatchersDisabled,
			},
		} satisfies ScenarioArtifact;
	});

export type RepetitionPlan = {
	readonly repetition: number;
	readonly round: number | null;
	readonly orderInRound: number | null;
	readonly profileToken: string | null;
	readonly notes: ReadonlyArray<string>;
};

export const armProfile = (input: {
	readonly token: string;
	readonly scriptSlug: string;
	readonly executions: number;
	readonly maxHeapSnapshotsPerAttempt: number;
}) =>
	getApiClient().call(
		(client) =>
			client.testSupport.armSandboxProfile({
				payload: {
					cpuProfile: true,
					token: input.token,
					maxAttemptsPerExecution: 24,
					scriptSlug: input.scriptSlug,
					executions: input.executions,
					maxHeapSnapshotsPerAttempt: input.maxHeapSnapshotsPerAttempt,
				},
			}),
		adminHeaders(),
	);

export const profileStatus = (token: string) =>
	getApiClient().call(
		(client) => client.testSupport.getSandboxProfileStatus({ params: { token } }),
		adminHeaders(),
	);

export const profiledScriptSlug = (context: RunContext, scenario: ScenarioDefinition) => {
	if (scenario.submission === "live-search") {
		return "music.youtube-music.search";
	}
	if (scenario.submission === "live-details" || scenario.submission === "live-import") {
		return "music.youtube-music.details";
	}
	return `${context.state.pluginSlug}.script`;
};

/** Runs one fresh-process repetition end to end and returns its committed artifact. */
export const runFreshRepetition = (
	context: RunContext,
	scenario: ScenarioDefinition,
	plan: RepetitionPlan,
): Effect.Effect<ScenarioArtifact, unknown> =>
	Effect.gen(function* () {
		yield* Effect.log("sandbox-resource-baseline.repetition.start", {
			round: plan.round,
			scenarioId: scenario.id,
			repetition: plan.repetition,
			workerConcurrency: scenario.workerConcurrency,
		});
		const prepared = yield* prepareFreshProcess(context, scenario);
		const { remote } = context;
		if (plan.profileToken !== null) {
			yield* armProfile({
				executions: 1,
				token: plan.profileToken,
				maxHeapSnapshotsPerAttempt: 2,
				scriptSlug: profiledScriptSlug(context, scenario),
			});
		}
		const [appOffset, hostOffset] = yield* Effect.all([
			remote.fileSize(REMOTE_FILES.appSamples),
			remote.fileSize(REMOTE_FILES.hostSamples),
		]);
		const phaseSequence = yield* listPhaseSegments(0).pipe(
			Effect.map((segments) => segments.at(-1)?.sequence ?? 0),
		);
		const containersBefore = yield* remote.metadata.pipe(
			Effect.map(({ containers }) => containers as ReadonlyArray<Record<string, unknown>>),
		);
		const peakReset = yield* remote.resetPeak;
		const startedAtMs = yield* Clock.currentTimeMillis;
		// A live search is measured on its own, never inside the first import's resource interval.
		const live =
			scenario.submission === "live-import" && scenario.liveSearch !== null
				? yield* liveSearchRequest(context, scenario.liveSearch)
				: null;
		const submittedAtMs = yield* Clock.currentTimeMillis;
		const submission = yield* submitWave(context, scenario, {
			wave: 1,
			workload: scenario.workload,
			idleAfterSubmitMs: scenario.idleDurationMs,
			nonce: `${context.runId}-${scenario.id}-${plan.repetition}`,
			liveExternalIds: live?.externalIds ?? context.state.liveExternalIds,
		}).pipe(
			Effect.timeoutOrElse({
				duration: `${context.config.requestTimeoutMs} millis`,
				orElse: () => Effect.succeed({ requests: [], importRecords: [] }),
			}),
		);
		const terminalAtMs = yield* Clock.currentTimeMillis;
		if (scenario.recoveryWindowMs > 0) {
			yield* Effect.sleep(`${scenario.recoveryWindowMs} millis`);
		}
		const completedAtMs = yield* Clock.currentTimeMillis;
		return yield* captureRepetition(context, scenario, {
			appOffset,
			hostOffset,
			waves: null,
			startedAtMs,
			terminalAtMs,
			submittedAtMs,
			completedAtMs,
			phaseSequence,
			containersBefore,
			round: plan.round,
			preSample: prepared.sample,
			repetition: plan.repetition,
			orderInRound: plan.orderInRound,
			importRecords: submission.importRecords,
			profileIds: plan.profileToken === null ? [] : [plan.profileToken],
			requests: [...(live === null ? [] : [live.request]), ...submission.requests],
			peakReset:
				peakReset === null
					? null
					: { verified: peakReset.verified, supported: peakReset.supported },
			notes: [
				...plan.notes,
				...(prepared.stabilization.stable ? [] : ["fresh-process RSS did not stabilize in time"]),
			],
		});
	});
