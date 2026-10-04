import { Config, Effect, FileSystem, Schema } from "effect";

import { setupE2e } from "./global-setup";
import type { MetricSnapshot } from "./s3-benchmark-records";
import { RoleMetricSnapshot } from "./s3-benchmark-records";
import { runPromise } from "./src/support/e2e-runtime";
import { startFakeHttpServer } from "./src/support/fake-http-server";

const Numeric = Schema.Union([Schema.Finite, Schema.String]);
const AttributeValue = Schema.Struct({
	intValue: Schema.optional(Numeric),
	stringValue: Schema.optional(Schema.String),
});
const DataPoint = Schema.Struct({
	sum: Schema.optional(Numeric),
	count: Schema.optional(Numeric),
	asInt: Schema.optional(Numeric),
	asDouble: Schema.optional(Numeric),
	timeUnixNano: Schema.optional(Numeric),
	bucketCounts: Schema.optional(Schema.Array(Numeric)),
	explicitBounds: Schema.optional(Schema.Array(Numeric)),
	attributes: Schema.optional(
		Schema.Array(Schema.Struct({ key: Schema.String, value: AttributeValue })),
	),
});
const Points = Schema.Struct({ dataPoints: Schema.Array(DataPoint) });
const OtlpMetricsBody = Schema.Struct({
	resourceMetrics: Schema.Array(
		Schema.Struct({
			resource: Schema.Struct({
				attributes: Schema.Array(Schema.Struct({ key: Schema.String, value: AttributeValue })),
			}),
			scopeMetrics: Schema.Array(
				Schema.Struct({
					metrics: Schema.Array(
						Schema.Struct({
							name: Schema.String,
							sum: Schema.optional(Points),
							gauge: Schema.optional(Points),
							histogram: Schema.optional(Points),
						}),
					),
				}),
			),
		}),
	),
});

const optionalNumber = (value: number | string | undefined) =>
	value === undefined ? null : Number(value);

const ROLE_ATTRIBUTE = "ryot.server.role";

const metricSnapshotFromOtlp = (body: unknown): Schema.Schema.Type<typeof RoleMetricSnapshot> => {
	const decoded = Schema.decodeUnknownSync(OtlpMetricsBody)(body);
	const metrics: Record<string, MetricSnapshot["metrics"][string]> = {};
	let atMs = 0;
	let role = "";
	for (const resource of decoded.resourceMetrics) {
		role =
			resource.resource.attributes.find(({ key }) => key === ROLE_ATTRIBUTE)?.value.stringValue ??
			role;
		for (const scope of resource.scopeMetrics) {
			for (const metric of scope.metrics) {
				if (!metric.name.startsWith("ryot.")) {
					continue;
				}
				const points = (metric.sum ?? metric.gauge ?? metric.histogram)?.dataPoints ?? [];
				metrics[metric.name] = points.map((point) => {
					atMs = Math.max(atMs, Number(point.timeUnixNano ?? 0) / 1_000_000);
					return {
						sum: optionalNumber(point.sum),
						count: optionalNumber(point.count),
						buckets: (point.bucketCounts ?? []).map(Number),
						bounds: (point.explicitBounds ?? []).map(Number),
						value: optionalNumber(point.asInt ?? point.asDouble),
						attributes: Object.fromEntries(
							(point.attributes ?? []).map(({ key, value }) => [
								key,
								value.stringValue ?? String(value.intValue ?? ""),
							]),
						),
					};
				});
			}
		}
	}
	return { role, snapshot: { metrics, atMs: Math.round(atMs) } };
};

const ServerEnv = Schema.fromJsonString(Schema.Record(Schema.String, Schema.String));
const SnapshotLine = Schema.fromJsonString(RoleMetricSnapshot);
const TraceLine = Schema.fromJsonString(Schema.Unknown);

const pinnedServerEnv = {
	SERVER_LANES: "split",
	DATABASE_POOL_MAX: "10",
	SERVER_LOG_LEVEL: "info",
	SERVER_LOG_ROTATION_SIZE: "4G",
	SANDBOX_WORKER_CONCURRENCY: "2",
	SANDBOX_MEMORY_BUDGET_MIB: "1904",
} as const;

const startMetricsSink = Effect.gen(function* () {
	const outDir = yield* Config.String("S3_BENCHMARK_OUT_DIR");
	const runName = yield* Config.String("S3_BENCHMARK_RUN_NAME");
	const metricsFile = `${outDir}/otlp-${runName}.ndjson`;
	const tracesFile = `${outDir}/traces-${runName}.ndjson`;
	const fs = yield* FileSystem.FileSystem;
	const lines: Array<string> = [];
	const pending: { requests?: Array<{ body: unknown; path: string }> } = {};
	const sink = yield* startFakeHttpServer(() =>
		Effect.gen(function* () {
			const received = pending.requests?.splice(0) ?? [];
			for (const { body, path } of received) {
				if (path === "/v1/metrics") {
					const line = metricSnapshotFromOtlp(body);
					// The one-shot migration process exports as `all`; it serves none of the measured work.
					if (line.role === "interactive" || line.role === "background") {
						lines.push(`${yield* Schema.encodeEffect(SnapshotLine)(line)}\n`);
						yield* Effect.promise(() => Bun.write(metricsFile, lines.join("")));
					}
				}
				if (path === "/v1/traces") {
					const line = yield* Schema.encodeEffect(TraceLine)(body);
					yield* fs.writeFileString(tracesFile, `${line}\n`, { flag: "a" });
				}
			}
			return Response.json({});
		}).pipe(Effect.orDie),
	);
	pending.requests = sink.requests;
	const socketDirectory = yield* fs.makeTempDirectory({ prefix: "ryot-s3-runner-" });
	return {
		sink,
		metricsFile,
		socketDirectory,
		serverEnv: yield* Schema.encodeEffect(ServerEnv)(pinnedServerEnv),
	};
});

// oxlint-disable-next-line effecttsgo/async-function -- Vitest globalSetup owns the Promise-returning setup contract.
export default async () => {
	const { sink, serverEnv, metricsFile, socketDirectory } = await runPromise(
		startMetricsSink.pipe(Effect.orDie),
	);
	const stopServer = await setupE2e({
		...pinnedServerEnv,
		OTEL_EXPORTER_OTLP_ENDPOINT: sink.url,
		SERVER_RUNNER_SOCKET_DIR: socketDirectory,
	});
	process.env.S3_BENCHMARK_SERVER_ENV = serverEnv;
	process.env.S3_BENCHMARK_OTLP_FILE = metricsFile;
	return () =>
		runPromise(
			Effect.gen(function* () {
				yield* Effect.promise(stopServer);
				yield* Effect.promise(sink.stop);
				const fs = yield* FileSystem.FileSystem;
				yield* fs.remove(socketDirectory, { force: true, recursive: true });
			}),
		);
};
