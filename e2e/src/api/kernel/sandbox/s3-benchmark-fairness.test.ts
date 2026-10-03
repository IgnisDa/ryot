import type { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { Cause, Clock, Config, DateTime, Effect, Exit } from "effect";

import {
	createAuthenticatedClient,
	enqueueSandboxScript,
	pollSandboxResult,
	requireCompletedSandboxValue,
} from "~/fixtures/kernel";
import {
	benchmarkConfiguration,
	benchmarkInputs,
	benchmarkParameters,
	FAIRNESS_POLICY,
	inputHash,
	installFairnessSystemPlugin,
	installFairnessUserPlugin,
	readMetricWindow,
	s3SourceHashes,
	startBenchmarkHttpServer,
	startHostSampler,
	writeBenchmarkRecord,
} from "~/fixtures/kernel/s3-benchmark";
import { assertCondition } from "~/support/assertions";
import { describe, it } from "~/support/effect-test";

import { FairnessRecord, percentile } from "../../../../s3-benchmark-records";

const METRIC_FLUSH_WAIT_MS = 12_000;
const PROGRESS_INTERVAL_MS = 5_000;

const userSpecs = [
	{ label: "a", system: true, plugins: ["one", "two", "three"] },
	{ label: "b", system: false, plugins: ["one"] },
] as const;

type Completion = { atMs: number; failed: boolean; failure?: string; latencyMs: number };
type Progress = { admissions: number; atMs: number; completed: number };

describe.skipIf(process.env.S3_BENCHMARK !== "1")("S3 fairness benchmark", () => {
	it.live(
		"saturating_user_plugins_do_not_exceed_their_execution_or_http_share",
		() =>
			Effect.gen(function* () {
				const parameters = yield* benchmarkParameters;
				const serverPid = yield* Config.Int("E2E_SERVER_PID");
				const server = yield* startBenchmarkHttpServer;
				const host = yield* startHostSampler(serverPid);
				const systemPlugin = yield* installFairnessSystemPlugin({
					label: "a",
					origin: server.origin,
					policy: FAIRNESS_POLICY,
					iterations: parameters.cpuIterations,
				});

				const users = yield* Effect.forEach(userSpecs, (spec) =>
					Effect.gen(function* () {
						const user = yield* createAuthenticatedClient();
						const scripts: Array<SandboxScriptId> = [];
						for (const plugin of spec.plugins) {
							const installed = yield* installFairnessUserPlugin({
								plugin,
								label: spec.label,
								client: user.client,
								origin: server.origin,
								iterations: parameters.cpuIterations,
							});
							scripts.push(installed.scriptId);
						}
						if (spec.system) {
							scripts.push(systemPlugin.scriptId);
						}
						return {
							spec,
							scripts,
							userId: user.userId,
							progress: [] as Array<Progress>,
							completions: [] as Array<Completion>,
						};
					}),
				);

				// Saturating users queue far longer than the default poll bound; only the scope may end a poll.
				const pollTimeoutMs =
					parameters.fairnessSettleTimeoutMs +
					parameters.fairnessWindowMs +
					2 * METRIC_FLUSH_WAIT_MS;
				const startedAtMs = yield* Clock.currentTimeMillis;
				for (const user of users) {
					for (const scriptId of user.scripts) {
						for (let slot = 0; slot < parameters.fairnessDepth; slot += 1) {
							yield* Effect.gen(function* () {
								for (;;) {
									const enqueuedAt = performance.now();
									const outcome = yield* Effect.exit(
										Effect.gen(function* () {
											const { jobId } = yield* enqueueSandboxScript(user.userId, {
												scriptId,
												context: {},
												lane: "background",
											});
											const result = yield* pollSandboxResult(user.userId, jobId, pollTimeoutMs);
											requireCompletedSandboxValue(result);
										}),
									);
									user.completions.push({
										failed: Exit.isFailure(outcome),
										...(Exit.isFailure(outcome)
											? { failure: Cause.pretty(outcome.cause).slice(0, 400) }
											: {}),
										atMs: yield* Clock.currentTimeMillis,
										latencyMs: performance.now() - enqueuedAt,
									});
								}
							}).pipe(Effect.forkScoped);
						}
					}
				}

				const admissionsFor = (label: string) =>
					server.log.filter(({ path }) => path.startsWith(`/fair/${label}/`));
				const sampleProgress = Effect.gen(function* () {
					yield* Effect.sleep(`${PROGRESS_INTERVAL_MS} millis`);
					const now = yield* Clock.currentTimeMillis;
					for (const user of users) {
						user.progress.push({
							atMs: now,
							completed: user.completions.length,
							admissions: admissionsFor(user.spec.label).length,
						});
					}
					return now;
				});
				// Deeper users drain their initial suspended batch later; the window opens once every user has.
				let windowStartedAtMs = startedAtMs;
				while (
					users.some(
						({ scripts, completions }) =>
							completions.length < scripts.length * parameters.fairnessDepth,
					)
				) {
					windowStartedAtMs = yield* sampleProgress;
					assertCondition(
						windowStartedAtMs - startedAtMs <= parameters.fairnessSettleTimeoutMs,
						"Fairness users did not finish their initial in-flight work",
					);
				}
				const windowEndedAtMs = windowStartedAtMs + parameters.fairnessWindowMs;
				for (let now = windowStartedAtMs; now < windowEndedAtMs;) {
					now = yield* sampleProgress;
				}
				yield* Effect.sleep(`${METRIC_FLUSH_WAIT_MS} millis`);

				const inWindow = ({ atMs }: { atMs: number }) =>
					atMs > windowStartedAtMs && atMs <= windowEndedAtMs;
				const userRecords = users.map(({ spec, progress, completions }) => {
					const windowed = completions.filter(inWindow);
					const latencies = windowed.map(({ latencyMs }) => latencyMs);
					return {
						progress,
						label: spec.label,
						completedTotal: completions.length,
						completedInWindow: windowed.length,
						admissionsTotal: admissionsFor(spec.label).length,
						plugins: spec.plugins.length + (spec.system ? 1 : 0),
						failed: completions.filter(({ failed }) => failed).length,
						admissionsInWindow: admissionsFor(spec.label).filter(inWindow).length,
						latencyP50Ms: latencies.length === 0 ? null : percentile(latencies, 50),
						latencyP95Ms: latencies.length === 0 ? null : percentile(latencies, 95),
						failureSamples: completions
							.flatMap(({ failure }) => (failure === undefined ? [] : [failure]))
							.slice(0, 3),
					};
				});
				const [first, second] = userRecords;
				assertCondition(first !== undefined && second !== undefined, "Fairness users missing");
				const executionDifference = Math.abs(first.completedInWindow - second.completedInWindow);
				const admissionDifference = Math.abs(first.admissionsInWindow - second.admissionsInWindow);
				const record: FairnessRecord = {
					host: [...host],
					windowEndedAtMs,
					kind: "fairness",
					windowStartedAtMs,
					users: userRecords,
					windowMs: parameters.fairnessWindowMs,
					startedAt: DateTime.formatIso(DateTime.makeUnsafe(startedAtMs)),
					metrics: yield* readMetricWindow(parameters.otlpFile, windowStartedAtMs, windowEndedAtMs),
					tolerance: {
						executions: parameters.fairnessExecutionTolerance,
						admissions: parameters.fairnessAdmissionTolerance,
					},
					hashes: {
						sources: {
							"fairness.script": s3SourceHashes(parameters.cpuIterations)["fairness.script"],
						},
						inputs: inputHash(benchmarkInputs({ warmup: 0, measured: 0 }), {
							depth: parameters.fairnessDepth,
						}),
					},
					configuration: {
						...benchmarkConfiguration(parameters, FAIRNESS_POLICY),
						fairnessDepth: parameters.fairnessDepth,
						fairnessWindowMs: parameters.fairnessWindowMs,
						fairnessSettleTimeoutMs: parameters.fairnessSettleTimeoutMs,
					},
					result: {
						executionDifference,
						admissionDifference,
						pass:
							first.completedInWindow > 0 &&
							second.completedInWindow > 0 &&
							first.failed + second.failed === 0 &&
							executionDifference <= parameters.fairnessExecutionTolerance &&
							admissionDifference <= parameters.fairnessAdmissionTolerance,
					},
				};
				yield* writeBenchmarkRecord(
					FairnessRecord,
					record,
					`${parameters.outDir}/${parameters.runName}.json`,
				);
				assertCondition(
					record.result.pass,
					`Fairness criterion failed: executions differ by ${executionDifference}, admissions by ${admissionDifference}`,
				);
			}),
		7_200_000,
	);
});
