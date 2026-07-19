import { heapStats, profile, type SamplingProfile } from "bun:jsc";

import {
	TestSupportBadRequest,
	type TestSupportArmSandboxProfileBody,
	TestSupportBackendCheckpoint,
	type TestSupportBackendProfileBody,
} from "@ryot-app/contract/modules/test-support/schemas";
import { sql } from "drizzle-orm";
import { Clock, Context, Deferred, Effect, FileSystem, Layer, Option, Schema } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import {
	appendRestrictedLine,
	BenchmarkProfiler,
	createRestrictedDirectory,
} from "#lib/infrastructure/sandbox-runtime/benchmark-profiler";
import {
	readCgroupSample,
	readProcessSmapsRollup,
} from "#lib/infrastructure/sandbox-runtime/process-sampling";

const TOP_OBJECT_TYPES = 40;

const encodeCheckpoint = Schema.encodeSync(Schema.fromJsonString(TestSupportBackendCheckpoint));

const profilingDisabled = () =>
	new TestSupportBadRequest({
		reason: {
			code: "invalid-request",
			diagnostic: "Benchmark profiling is disabled; set SANDBOX_BENCHMARK_PROFILE_DIR",
		},
	});

const conflict = (diagnostic: string) =>
	new TestSupportBadRequest({ reason: { diagnostic, code: "invalid-request" } });

export class BenchmarkProfilingService extends Context.Service<BenchmarkProfilingService>()(
	"BenchmarkProfilingService",
	{
		make: Effect.gen(function* () {
			const config = yield* AppConfig;
			const database = yield* Database;
			const profiler = yield* BenchmarkProfiler;
			const fs = yield* FileSystem.FileSystem;
			const root = Option.getOrUndefined(config.sandbox.benchmarkProfileDir);
			let cpuSession:
				| { readonly stop: Deferred.Deferred<void>; readonly result: Promise<SamplingProfile> }
				| undefined;

			const armSandboxProfile = Effect.fn("BenchmarkProfilingService.armSandboxProfile")(
				(body: TestSupportArmSandboxProfileBody) =>
					profiler.arm(body).pipe(Effect.mapError(profilingDisabled)),
			);

			const getSandboxProfileStatus = Effect.fn(
				"BenchmarkProfilingService.getSandboxProfileStatus",
			)((token: string) => profiler.status(token).pipe(Effect.mapError(profilingDisabled)));

			const disarmSandboxProfiles = Effect.fn("BenchmarkProfilingService.disarmSandboxProfiles")(
				function* () {
					return { disarmed: yield* profiler.disarm.pipe(Effect.mapError(profilingDisabled)) };
				},
			);

			const countActiveWorkflows = mapDatabaseErrors(
				database.execute<{ count: number }>(
					sql`SELECT count(*)::int AS count FROM sandbox_workflow_reference`,
					"objects",
				),
			).pipe(
				Effect.map(([row]) => row?.count ?? null),
				Effect.orElseSucceed(() => null),
			);

			const readCheckpoint = (input: {
				readonly label: string;
				readonly action: string;
				readonly file: string | null;
			}) =>
				Effect.gen(function* () {
					const [timestampMs, smapsRollup, cgroup, activeWorkflows] = yield* Effect.all([
						Clock.currentTimeMillis,
						process.platform === "linux" ? readProcessSmapsRollup("self") : Effect.succeed(null),
						readCgroupSample(),
						countActiveWorkflows,
					]);
					const memory = process.memoryUsage();
					const stats = heapStats();
					return {
						...input,
						timestampMs,
						smapsRollup,
						activeWorkflows,
						cgroupMemoryCurrentBytes: cgroup?.memoryCurrentBytes ?? null,
						processMemory: {
							rss: memory.rss,
							external: memory.external,
							heapUsed: memory.heapUsed,
							heapTotal: memory.heapTotal,
							arrayBuffers: memory.arrayBuffers,
						},
						jscHeap: {
							heapSize: stats.heapSize,
							objectCount: stats.objectCount,
							heapCapacity: stats.heapCapacity,
							extraMemorySize: stats.extraMemorySize,
							globalObjectCount: stats.globalObjectCount,
							protectedObjectCount: stats.protectedObjectCount,
							topObjectTypes: Object.entries(stats.objectTypeCounts)
								.sort(([, left], [, right]) => right - left)
								.slice(0, TOP_OBJECT_TYPES)
								.map(([type, count]) => ({ type, count })),
						},
					};
				});

			const captureBackendProfile = Effect.fn("BenchmarkProfilingService.captureBackendProfile")(
				function* (body: TestSupportBackendProfileBody) {
					if (root === undefined) {
						return yield* profilingDisabled();
					}
					const directory = `${root}/${body.token}`;
					yield* createRestrictedDirectory(fs, directory);
					let file: string | null = null;
					if (body.action === "gc") {
						Bun.gc(true);
					} else if (body.action === "heap-snapshot") {
						file = `bun-heap-${body.label}.heapsnapshot`;
						const snapshot = Bun.generateHeapSnapshot("v8");
						yield* fs.writeFileString(`${directory}/${file}`, snapshot, { mode: 0o600 });
					} else if (body.action === "cpu-start") {
						if (cpuSession !== undefined) {
							return yield* conflict("A backend CPU profile is already running");
						}
						const stop = yield* Deferred.make<void>();
						const services = yield* Effect.context();
						cpuSession = {
							stop,
							result: profile(() => Effect.runPromiseWith(services)(Deferred.await(stop)), 1_000),
						};
					} else if (body.action === "cpu-stop") {
						const session = cpuSession;
						if (session === undefined) {
							return yield* conflict("No backend CPU profile is running");
						}
						cpuSession = undefined;
						yield* Deferred.succeed(session.stop, undefined);
						const sampled = yield* Effect.promise(() => session.result);
						file = `bun-cpu-${body.label}.json`;
						yield* fs.writeFileString(
							`${directory}/${file}`,
							yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(
								sampled.stackTraces,
							),
							{ mode: 0o600 },
						);
					}
					const checkpoint = yield* readCheckpoint({
						file,
						label: body.label,
						action: body.action,
					});
					yield* appendRestrictedLine(
						fs,
						`${directory}/bun-checkpoints.jsonl`,
						encodeCheckpoint(checkpoint),
					);
					return checkpoint;
				},
				Effect.mapError((error) =>
					error instanceof TestSupportBadRequest
						? error
						: new TestSupportBadRequest({
								reason: { code: "invalid-request", diagnostic: String(error) },
							}),
				),
			);

			return {
				armSandboxProfile,
				disarmSandboxProfiles,
				captureBackendProfile,
				getSandboxProfileStatus,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(BenchmarkProfiler.layer),
	);
}
