import { Clock, Config, DateTime, Effect } from "effect";

import {
	type Client,
	enqueueProviderEntityImport,
	findBuiltinSchemaBySlug,
	searchProviderEntities,
} from "~/fixtures/kernel";
import {
	backgroundStall,
	type AdmissionTiming,
	admissionForExecution,
	admissionForSearch,
	benchmarkConfiguration,
	benchmarkInputs,
	benchmarkParameters,
	createRefreshingBenchmarkClient,
	DETAILS_POLL_INTERVAL_MS,
	HOST_SAMPLE_INTERVAL_MS,
	inputHash,
	installBenchmarkPolicyPlugin,
	installBenchmarkProvider,
	LATENCY_POLICY,
	meanBusy,
	minimumRollingBusy,
	readAdmissionTimings,
	readMetricWindow,
	s3SourceHashes,
	SATURATION_THRESHOLD,
	SATURATION_WINDOW_MS,
	startBackgroundLoad,
	startBenchmarkHttpServer,
	startHostSampler,
	STALL_LIMIT_MS,
	writeBenchmarkRecord,
} from "~/fixtures/kernel/s3-benchmark";
import { assertCompleted, assertCondition, requirePresent } from "~/support/assertions";
import { describe, it } from "~/support/effect-test";
import { getServerLogFile } from "~/support/harness-target";

import { type LatencySample, LatencyTrialRecord } from "../../../../s3-benchmark-records";

const METRIC_FLUSH_WAIT_MS = 12_000;
const CLOCK_MARGIN_MS = 5;
const DETAILS_EXECUTION_SUFFIX = "-provider-population-sandbox-details";

const inputAt = (inputs: ReadonlyArray<string>, index: number) =>
	requirePresent(inputs[index], "Benchmark input sequences differ in length");

const withAdmission = (sample: LatencySample, found: AdmissionTiming | undefined) => ({
	...sample,
	ticketWaitMs: found?.ticketWaitMs ?? null,
	resumeDelayMs: found?.resumeDelayMs ?? null,
	executionId: found?.executionId ?? sample.executionId,
});

const timed = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.gen(function* () {
		const startedAt = performance.now();
		const startedAtMs = yield* Clock.currentTimeMillis;
		const value = yield* effect;
		return { value, startedAt, startedAtMs, durationMs: performance.now() - startedAt };
	});

const pollImportResult = (client: Client, jobId: string) =>
	Effect.gen(function* () {
		for (;;) {
			const result = yield* client.call((api) =>
				api.providerEntities.getImportResult({ params: { jobId } }),
			);
			if (result.status !== "queued" && result.status !== "running") {
				return result;
			}
			yield* Effect.sleep(`${DETAILS_POLL_INTERVAL_MS} millis`);
		}
	});

describe.skipIf(process.env.S3_BENCHMARK !== "1")("S3 interactive latency benchmark", () => {
	it.live(
		"interactive_search_and_details_meet_e2_under_import_load",
		() =>
			Effect.gen(function* () {
				const parameters = yield* benchmarkParameters;
				const serverPid = yield* Config.Int("E2E_SERVER_PID");
				const inputs = benchmarkInputs(parameters);
				const loaded = parameters.mode === "loaded";
				const server = yield* startBenchmarkHttpServer;
				const interactive = yield* createRefreshingBenchmarkClient;
				const background = yield* createRefreshingBenchmarkClient;
				const { schema } = yield* findBuiltinSchemaBySlug(interactive.client, "book");
				yield* installBenchmarkPolicyPlugin({ origin: server.origin, policy: LATENCY_POLICY });
				const interactiveProvider = yield* installBenchmarkProvider({
					role: "interactive",
					origin: server.origin,
					client: interactive.client,
					rootEntitySchemaSlug: schema.id,
					iterations: parameters.cpuIterations,
				});
				const backgroundProvider = yield* installBenchmarkProvider({
					role: "background",
					origin: server.origin,
					client: background.client,
					rootEntitySchemaSlug: schema.id,
					iterations: parameters.cpuIterations,
				});
				const host = yield* startHostSampler(serverPid);

				const loadStartedAtMs = yield* Clock.currentTimeMillis;
				const load = loaded
					? yield* startBackgroundLoad({
							server,
							userId: background.userId,
							entitySchemaSlug: schema.id,
							gates: parameters.backgroundGates,
							providerId: backgroundProvider.providerId,
						})
					: undefined;

				let reachedAtMs: number | null = null;
				if (loaded) {
					const deadline = loadStartedAtMs + parameters.saturationTimeoutMs;
					for (let now = loadStartedAtMs; reachedAtMs === null && now < deadline;) {
						yield* Effect.sleep(`${HOST_SAMPLE_INTERVAL_MS} millis`);
						now = yield* Clock.currentTimeMillis;
						const busy = meanBusy(host, now - SATURATION_WINDOW_MS, now);
						if (
							now - loadStartedAtMs >= SATURATION_WINDOW_MS &&
							busy !== null &&
							busy >= SATURATION_THRESHOLD
						) {
							reachedAtMs = now;
						}
					}
				}
				const measurable = !loaded || reachedAtMs !== null || !parameters.requireSaturation;

				const searchOnce = (query: string) =>
					timed(
						searchProviderEntities(interactive.client, {
							query,
							page: 1,
							pageSize: 10,
							providerId: interactiveProvider.providerId,
						}),
					);
				const detailsOnce = (externalId: string) =>
					timed(
						Effect.gen(function* () {
							const { jobId } = yield* enqueueProviderEntityImport(interactive.client, {
								externalId,
								providerId: interactiveProvider.providerId,
							});
							assertCompleted(
								yield* pollImportResult(interactive.client, jobId),
								`details import ${externalId}`,
							);
							return `${jobId.slice(jobId.indexOf(".") + 1, jobId.lastIndexOf("."))}${DETAILS_EXECUTION_SUFFIX}`;
						}),
					);
				if (measurable) {
					for (const [index, query] of inputs.warmupSearch.entries()) {
						yield* searchOnce(query);
						yield* detailsOnce(inputAt(inputs.warmupDetails, index));
					}
				}
				const searchSamples: Array<LatencySample> = [];
				const detailsSamples: Array<LatencySample> = [];
				const measureStartedAtMs = yield* Clock.currentTimeMillis;
				if (measurable) {
					for (const [index, query] of inputs.search.entries()) {
						const externalId = inputAt(inputs.details, index);
						const search = yield* searchOnce(query);
						const details = yield* detailsOnce(externalId);
						const arrivals = server.arrivalByPath();
						const sample = (
							input: string,
							path: string,
							timing: { durationMs: number; startedAt: number; startedAtMs: number },
							executionId: string | null,
						): LatencySample => {
							const arrival = arrivals.get(path);
							return {
								index,
								input,
								executionId,
								ticketWaitMs: null,
								resumeDelayMs: null,
								durationMs: timing.durationMs,
								startedAtMs: timing.startedAtMs,
								httpArrivalMs: arrival === undefined ? null : arrival - timing.startedAt,
							};
						};
						searchSamples.push(sample(query, `/search/${query}`, search, null));
						detailsSamples.push(
							sample(externalId, `/details/${externalId}`, details, details.value),
						);
					}
				}
				const measureEndedAtMs = yield* Clock.currentTimeMillis;

				yield* Effect.sleep(`${METRIC_FLUSH_WAIT_MS} millis`);
				const timings = yield* readAdmissionTimings(getServerLogFile());
				const search = searchSamples.map((sample) =>
					withAdmission(
						sample,
						admissionForSearch(timings, {
							startMs: sample.startedAtMs - CLOCK_MARGIN_MS,
							endMs: sample.startedAtMs + sample.durationMs + CLOCK_MARGIN_MS,
						}),
					),
				);
				const details = detailsSamples.map((sample) =>
					withAdmission(
						sample,
						sample.executionId === null
							? undefined
							: admissionForExecution(timings, sample.executionId),
					),
				);
				const metrics = yield* readMetricWindow(
					parameters.otlpFile,
					measureStartedAtMs,
					measureEndedAtMs,
				);
				const progress = load?.progress ?? [];
				const maxStallMs = loaded
					? backgroundStall(metrics, measureStartedAtMs, measureEndedAtMs)
					: 0;
				const measurementBusy = meanBusy(host, measureStartedAtMs, measureEndedAtMs);
				const record: LatencyTrialRecord = {
					metrics,
					kind: "latency",
					host: [...host],
					measureEndedAtMs,
					measureStartedAtMs,
					mode: parameters.mode,
					pair: parameters.pair,
					samples: { search, details },
					resolutionMs: DETAILS_POLL_INTERVAL_MS,
					warmup: { search: parameters.warmup, details: parameters.warmup },
					configuration: benchmarkConfiguration(parameters, LATENCY_POLICY),
					startedAt: DateTime.formatIso(DateTime.makeUnsafe(measureStartedAtMs)),
					hashes: { inputs: inputHash(inputs), sources: s3SourceHashes(parameters.cpuIterations) },
					background: {
						progress,
						maxStallMs,
						gatesFailed: load?.stats.failed ?? 0,
						gatesStarted: load?.stats.started ?? 0,
						gatesCompleted: load?.stats.completed ?? 0,
						continuous: !loaded || maxStallMs <= STALL_LIMIT_MS,
					},
					saturation: {
						reachedAtMs,
						measurementBusy,
						windowMs: SATURATION_WINDOW_MS,
						threshold: SATURATION_THRESHOLD,
						required: parameters.requireSaturation,
						minRollingBusy: minimumRollingBusy(
							host,
							SATURATION_WINDOW_MS,
							measureStartedAtMs,
							measureEndedAtMs,
						),
						proven:
							!loaded ||
							(reachedAtMs !== null &&
								measurementBusy !== null &&
								measurementBusy >= SATURATION_THRESHOLD),
					},
				};
				yield* writeBenchmarkRecord(
					LatencyTrialRecord,
					record,
					`${parameters.outDir}/${parameters.runName}.json`,
				);
				assertCondition(
					measurable,
					"Host CPU never reached the saturation threshold before measurement",
				);
				assertCondition(
					record.background.continuous,
					`Background import progress stalled for ${maxStallMs} ms`,
				);
				assertCondition(record.background.gatesFailed === 0, "A background import gate failed");
			}),
		7_200_000,
	);
});
