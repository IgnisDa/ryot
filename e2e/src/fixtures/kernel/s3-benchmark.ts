import { cpus } from "node:os";

import { OAuthTokenResponse } from "@ryot-app/contract/oauth";
import {
	type EntitySchemaSlug,
	type SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Clock, Config, Effect, FileSystem, Schema } from "effect";

import { startMediaPopulationGate } from "~/fixtures/plugins/media";
import { assertCondition, requirePresent } from "~/support/assertions";
import { startFakeHttpServerScoped } from "~/support/fake-http-server";
import { getApiUrl, getServerLogFile } from "~/support/harness-target";

import {
	LATENCY_MODES,
	MetricSnapshot,
	sha256,
	type HostSample,
	type LatencyTrialRecord,
} from "../../../s3-benchmark-records";
import { listAdminSandboxScripts } from "./admin-sandbox-scripts";
import { type Client, createTestUser, refreshOAuthTokens } from "./auth";
import { makeSession } from "./contract-client";
import { getMediaPopulationGateResult, sampleOperationalPressure } from "./operational-gate";
import { literalSandboxSource } from "./sandbox-source";
import { installTestPlugin, installTestPluginBundle } from "./test-plugin";

export const S3_BENCHMARK_POLICY_KEY = "s3-bench";
export const DETAILS_POLL_INTERVAL_MS = 10;
export const STALL_LIMIT_MS = 30_000;
export const SATURATION_THRESHOLD = 0.9;
export const SATURATION_WINDOW_MS = 10_000;
export const HOST_SAMPLE_INTERVAL_MS = 1_000;
const BACKGROUND_GATE_ITEM_COUNT = 1_001;
export const LATENCY_POLICY = { requests: 50, intervalMs: 1_000 } as const;
export const FAIRNESS_POLICY = { requests: 3, intervalMs: 2_000 } as const;

const SEARCH_RESULT_COUNT = 10;
const CHECKSUM_SEED = 305_419_896;
const ORIGIN_PLACEHOLDER = "http://s3-benchmark.invalid";

const integer = (name: string, fallback: number) =>
	Config.Int(name).pipe(Config.withDefault(fallback));

export const benchmarkParameters = Effect.gen(function* () {
	return {
		pair: yield* integer("S3_BENCHMARK_PAIR", 1),
		warmup: yield* integer("S3_BENCHMARK_WARMUP", 20),
		outDir: yield* Config.String("S3_BENCHMARK_OUT_DIR"),
		runName: yield* Config.String("S3_BENCHMARK_RUN_NAME"),
		measured: yield* integer("S3_BENCHMARK_MEASURED", 200),
		otlpFile: yield* Config.String("S3_BENCHMARK_OTLP_FILE"),
		serverEnv: yield* Config.String("S3_BENCHMARK_SERVER_ENV"),
		fairnessDepth: yield* integer("S3_BENCHMARK_FAIRNESS_DEPTH", 30),
		backgroundGates: yield* integer("S3_BENCHMARK_BACKGROUND_GATES", 2),
		cpuIterations: yield* integer("S3_BENCHMARK_CPU_ITERATIONS", 10_000_000),
		fairnessWindowMs: yield* integer("S3_BENCHMARK_FAIRNESS_WINDOW_MS", 180_000),
		saturationTimeoutMs: yield* integer("S3_BENCHMARK_SATURATION_TIMEOUT_MS", 300_000),
		fairnessExecutionTolerance: yield* integer("S3_BENCHMARK_FAIRNESS_EXECUTION_TOLERANCE", 4),
		fairnessAdmissionTolerance: yield* integer("S3_BENCHMARK_FAIRNESS_ADMISSION_TOLERANCE", 2),
		fairnessSettleTimeoutMs: yield* integer("S3_BENCHMARK_FAIRNESS_SETTLE_TIMEOUT_MS", 900_000),
		requireSaturation: yield* Config.Boolean("S3_BENCHMARK_REQUIRE_SATURATION").pipe(
			Config.withDefault(true),
		),
		mode: yield* Config.Literals(LATENCY_MODES, "S3_BENCHMARK_MODE").pipe(
			Config.withDefault("unloaded" as const),
		),
	};
});
type BenchmarkParameters = Effect.Success<typeof benchmarkParameters>;

const padded = (index: number) => String(index).padStart(3, "0");
const sequence = (prefix: string, count: number) =>
	Array.from({ length: count }, (_, index) => `${prefix}-${padded(index)}`);

export const benchmarkInputs = (input: { measured: number; warmup: number }) => ({
	search: sequence("q", input.measured),
	details: sequence("d", input.measured),
	warmupSearch: sequence("w", input.warmup),
	warmupDetails: sequence("dw", input.warmup),
});
type BenchmarkInputs = ReturnType<typeof benchmarkInputs>;

const pinnedBody = (kind: string, items: number) =>
	JSON.stringify({
		kind,
		items: Array.from({ length: items }, (_, index) => ({
			id: index,
			text: "s3-benchmark-fixed-response-".repeat(8),
		})),
	});
const searchBody = pinnedBody("search", 8);
const detailsBody = pinnedBody("details", 24);
const fairnessBody = pinnedBody("fairness", 4);

const pinnedBodyHashes = {
	search: sha256(searchBody),
	details: sha256(detailsBody),
	fairness: sha256(fairnessBody),
};

const cpuLoop = (iterations: number) =>
	`for (let index = 0; index < ${iterations}; index += 1) { checksum = Math.imul(checksum ^ index, 2654435761) >>> 0; }`;

const splitIterations = (iterations: number) => {
	const first = Math.floor(iterations / 2);
	return { first, second: iterations - first };
};

type ProviderOperationKind = "details" | "search";

const providerSource = (input: {
	name: string;
	slug: string;
	origin: string;
	iterations: number;
	pathPrefix: string;
	operation: ProviderOperationKind;
}) => {
	const { first, second } = splitIterations(input.iterations);
	const url = JSON.stringify(`${input.origin}${input.pathPrefix}`);
	const run =
		input.operation === "search"
			? `(input, host) => Effect.gen(function* () {
    let checksum = ${CHECKSUM_SEED};
    ${cpuLoop(first)}
    yield* host.httpCall("GET", ${url} + encodeURIComponent(input.query));
    ${cpuLoop(second)}
    return {
      items: Array.from({ length: ${SEARCH_RESULT_COUNT} }, (_, index) => ({
        title: "S3 benchmark result " + index,
        externalId: input.query + "-" + index,
        metadata: [(checksum + index) % 1000],
      })),
    };
  })`
			: `(input, host) => Effect.gen(function* () {
    let checksum = ${CHECKSUM_SEED};
    ${cpuLoop(first)}
    yield* host.httpCall("GET", ${url} + encodeURIComponent(input.externalId));
    ${cpuLoop(second)}
    return { name: "S3 benchmark " + input.externalId + " " + checksum, properties: {} };
  })`;
	return `
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

export const manifest = defineManifest({
  kind: "provider",
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
});

export default defineProvider({
  manifest,
  run: ${run},
  operation: ${JSON.stringify(input.operation)},
});
`;
};

const workScriptSource = (input: {
	name: string;
	slug: string;
	url: string;
	iterations: number;
}) => {
	const { first, second } = splitIterations(input.iterations);
	return `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
});

export default defineScript({
  manifest,
  input: Schema.Struct({}),
  output: Schema.Struct({ checksum: Schema.Number }),
  run: (_input, host) => Effect.gen(function* () {
    let checksum = ${CHECKSUM_SEED};
    ${cpuLoop(first)}
    yield* host.httpCall("GET", ${JSON.stringify(input.url)});
    ${cpuLoop(second)}
    return { checksum };
  }),
});
`;
};

type ProviderRole = "background" | "interactive";

const providerOperations = (role: ProviderRole): ReadonlyArray<ProviderOperationKind> =>
	role === "interactive" ? ["search", "details"] : ["details"];

const providerPathPrefix = (role: ProviderRole, operation: ProviderOperationKind) =>
	role === "background" ? "/bg/" : `/${operation}/`;

const providerSlugFor = (role: ProviderRole) => `s3-bench-${role}`;

const providerSourceFor = (
	role: ProviderRole,
	operation: ProviderOperationKind,
	origin: string,
	iterations: number,
) =>
	providerSource({
		origin,
		operation,
		iterations,
		name: `S3 benchmark ${role} ${operation}`,
		slug: `${providerSlugFor(role)}.${operation}`,
		pathPrefix: providerPathPrefix(role, operation),
	});

const policySlug = "s3-bench-policy";
const policyScriptSlug = "s3-bench-policy.noop";
const fairnessSystemSlug = "s3-bench-fairness-system";

const fairnessUrl = (origin: string, label: string, plugin: string) =>
	`${origin}/fair/${label}/${plugin}`;

export const s3SourceHashes = (iterations: number) => ({
	"background.details": sha256(
		providerSourceFor("background", "details", ORIGIN_PLACEHOLDER, iterations),
	),
	"interactive.search": sha256(
		providerSourceFor("interactive", "search", ORIGIN_PLACEHOLDER, iterations),
	),
	"interactive.details": sha256(
		providerSourceFor("interactive", "details", ORIGIN_PLACEHOLDER, iterations),
	),
	"fairness.script": sha256(
		workScriptSource({
			iterations,
			slug: "s3-bench-fairness",
			name: "S3 benchmark fairness",
			url: fairnessUrl(ORIGIN_PLACEHOLDER, "label", "plugin"),
		}),
	),
});

export const inputHash = (inputs: BenchmarkInputs, extra: Record<string, unknown> = {}) =>
	sha256(JSON.stringify({ extra, inputs, bodies: pinnedBodyHashes }));

const pinnedBodyFor = (path: string) => {
	if (path.startsWith("/search/")) {
		return searchBody;
	}
	return path.startsWith("/fair/") ? fairnessBody : detailsBody;
};

type BenchmarkLog = Array<{ atMs: number; path: string; perfMs: number }>;

export const startBenchmarkHttpServer = Effect.gen(function* () {
	const log: BenchmarkLog = [];
	const server = yield* startFakeHttpServerScoped((url) => {
		log.push({ atMs: Date.now(), path: url.pathname, perfMs: performance.now() });
		return new Response(pinnedBodyFor(url.pathname), {
			headers: { "content-type": "application/json" },
		});
	});
	return {
		log,
		url: server.url,
		origin: new URL(server.url).origin,
		backgroundRequests: () => log.filter(({ path }) => path.startsWith("/bg/")).length,
		arrivalByPath: () => new Map(log.map(({ path, perfMs }) => [path, perfMs] as const)),
	};
});
type BenchmarkHttpServer = Effect.Success<typeof startBenchmarkHttpServer>;

const httpPolicy = (
	origin: string,
	policy: { intervalMs: number; requests: number },
	key = S3_BENCHMARK_POLICY_KEY,
) => ({ key, origins: [origin], ...policy });

export const installBenchmarkPolicyPlugin = (input: {
	origin: string;
	policy: { intervalMs: number; requests: number };
}) =>
	installTestPlugin({
		scope: "system",
		pluginSlug: policySlug,
		httpRateLimits: [httpPolicy(input.origin, input.policy)],
		source: literalSandboxSource({
			value: true,
			slug: policyScriptSlug,
			name: "S3 benchmark policy",
		}),
		script: {
			kind: "script",
			capabilities: [],
			slug: policyScriptSlug,
			name: "S3 benchmark policy",
			requiredPluginConfigKeys: [],
		},
	});

export const installFairnessSystemPlugin = (input: {
	label: string;
	origin: string;
	iterations: number;
	policy: { intervalMs: number; requests: number };
}) =>
	installTestPlugin({
		scope: "system",
		pluginSlug: fairnessSystemSlug,
		httpRateLimits: [httpPolicy(input.origin, input.policy)],
		script: {
			kind: "script",
			capabilities: ["httpCall"],
			requiredPluginConfigKeys: [],
			slug: `${fairnessSystemSlug}.work`,
			name: "S3 benchmark fairness system",
		},
		source: workScriptSource({
			iterations: input.iterations,
			slug: `${fairnessSystemSlug}.work`,
			name: "S3 benchmark fairness system",
			url: fairnessUrl(input.origin, input.label, "system"),
		}),
	});

export const installFairnessUserPlugin = (input: {
	label: string;
	client: Client;
	origin: string;
	plugin: string;
	iterations: number;
}) =>
	installTestPlugin({
		client: input.client,
		pluginSlug: `s3-bench-fairness-${input.label}-${input.plugin}`,
		script: {
			kind: "script",
			capabilities: ["httpCall"],
			requiredPluginConfigKeys: [],
			name: `S3 benchmark fairness ${input.label} ${input.plugin}`,
			slug: `s3-bench-fairness-${input.label}-${input.plugin}.work`,
		},
		source: workScriptSource({
			iterations: input.iterations,
			url: fairnessUrl(input.origin, input.label, input.plugin),
			name: `S3 benchmark fairness ${input.label} ${input.plugin}`,
			slug: `s3-bench-fairness-${input.label}-${input.plugin}.work`,
		}),
	});

export const installBenchmarkProvider = (input: {
	role: ProviderRole;
	client: Client;
	origin: string;
	iterations: number;
	rootEntitySchemaSlug: EntitySchemaSlug;
}) =>
	Effect.gen(function* () {
		const providerSlug = providerSlugFor(input.role);
		const operations = providerOperations(input.role);
		const scripts = operations.map((operation) => ({
			providerSlug,
			kind: "provider" as const,
			providerOperation: operation,
			requiredPluginConfigKeys: [],
			capabilities: ["httpCall" as const],
			slug: `${providerSlug}.${operation}`,
			name: `S3 benchmark ${input.role} ${operation}`,
			entry: `backend/providers/${providerSlug}/${operation}.sandbox.ts`,
		}));
		const files = Object.fromEntries(
			scripts.map((script) => [
				script.entry,
				providerSourceFor(input.role, script.providerOperation, input.origin, input.iterations),
			]),
		);
		const installed = yield* installTestPluginBundle({
			files,
			scripts,
			client: input.client,
			pluginSlug: providerSlug,
			providers: [
				{
					slug: providerSlug,
					information: { source: "s3-benchmark" },
					name: `S3 benchmark ${input.role} provider`,
					rootEntitySchemaSlug: input.rootEntitySchemaSlug,
					operations: {
						details: `${providerSlug}.details`,
						...(operations.includes("search") ? { search: `${providerSlug}.search` } : {}),
					},
				},
			],
		});
		const detailsScriptId = requirePresent(
			installed.scriptIds[`${providerSlug}.details`],
			"Benchmark provider details script was not installed",
		);
		const stored = (yield* listAdminSandboxScripts(installed.activePluginRevisionId)).find(
			({ id }) => id === detailsScriptId,
		);
		return {
			installed,
			providerId: requirePresent(stored?.providerId, "Benchmark provider ID was not returned"),
		};
	});

const readCpuTimes = () => {
	let idle = 0;
	let total = 0;
	for (const { times } of cpus()) {
		idle += times.idle;
		total += times.user + times.nice + times.sys + times.idle + times.irq;
	}
	return { idle, total };
};

const processTreeRssMiB = (rootPid: number) => {
	const rows = new TextDecoder()
		.decode(Bun.spawnSync(["ps", "-A", "-o", "pid=,ppid=,rss="]).stdout)
		.split("\n")
		.flatMap((line) => {
			const [pid, parent, rss] = line.trim().split(/\s+/).map(Number);
			return pid === undefined || parent === undefined || rss === undefined || Number.isNaN(rss)
				? []
				: [{ pid, rss, parent }];
		});
	const members = new Set([rootPid]);
	for (let grew = true; grew;) {
		grew = false;
		for (const { pid, parent } of rows) {
			if (members.has(parent) && !members.has(pid)) {
				members.add(pid);
				grew = true;
			}
		}
	}
	return rows.reduce((sum, { pid, rss }) => (members.has(pid) ? sum + rss : sum), 0) / 1024;
};

// Trials outlive one access token, so the client renews it the way an interactive client does.
export const createRefreshingBenchmarkClient = Effect.gen(function* () {
	const user = yield* createTestUser();
	const userId = UserId.make(user.userId);
	let token = user.token;
	let refreshToken = user.refreshToken;
	const renew = Effect.gen(function* () {
		const response = yield* refreshOAuthTokens(getApiUrl(), refreshToken);
		assertCondition(response.ok, `OAuth refresh failed: ${response.status}`);
		const tokens = yield* Schema.decodeUnknownEffect(OAuthTokenResponse)(
			yield* Effect.promise(() => response.json()),
		);
		token = tokens.access_token;
		refreshToken = tokens.refresh_token ?? refreshToken;
		return tokens.expires_in;
	});
	const expiresInSeconds = yield* renew;
	yield* Effect.gen(function* () {
		yield* Effect.sleep(`${expiresInSeconds / 2} seconds`);
		yield* renew;
	}).pipe(Effect.forever, Effect.forkScoped);
	const client: Client = {
		userId,
		call: (program, headers = {}) =>
			makeSession(getApiUrl(), { Authorization: `Bearer ${token}` }, userId).call(program, headers),
	};
	return { client, userId: user.userId };
});

export const startHostSampler = (serverPid: number) =>
	Effect.gen(function* () {
		const samples: Array<HostSample> = [];
		let previous = readCpuTimes();
		yield* Effect.gen(function* () {
			yield* Effect.sleep(`${HOST_SAMPLE_INTERVAL_MS} millis`);
			const current = readCpuTimes();
			const totalDelta = current.total - previous.total;
			const cpuBusy = totalDelta > 0 ? 1 - (current.idle - previous.idle) / totalDelta : null;
			previous = current;
			const pressure = yield* sampleOperationalPressure(["s3-benchmark"]).pipe(Effect.option);
			if (pressure._tag === "Some") {
				samples.push({
					cpuBusy,
					atMs: yield* Clock.currentTimeMillis,
					serverTreeRssMiB: processTreeRssMiB(serverPid),
					activeExecutions: pressure.value.sandbox.activeExecutions,
					totalConnections: pressure.value.database.totalConnections,
					activeConnections: pressure.value.database.activeConnections,
					lockWaitingConnections: pressure.value.database.lockWaitingConnections,
				});
			}
		}).pipe(Effect.forever, Effect.forkScoped);
		return samples;
	});

export const meanBusy = (samples: ReadonlyArray<HostSample>, fromMs: number, toMs: number) => {
	const values = samples
		.filter(({ atMs }) => atMs > fromMs && atMs <= toMs)
		.flatMap(({ cpuBusy }) => (cpuBusy === null ? [] : [cpuBusy]));
	return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
};

export const minimumRollingBusy = (
	samples: ReadonlyArray<HostSample>,
	windowMs: number,
	fromMs: number,
	toMs: number,
) => {
	const rolling = samples
		.filter(({ atMs }) => atMs >= fromMs + windowMs && atMs <= toMs)
		.map(({ atMs }) => meanBusy(samples, atMs - windowMs, atMs))
		.filter((value): value is number => value !== null);
	return rolling.length === 0 ? null : Math.min(...rolling);
};

export const startBackgroundLoad = (input: {
	gates: number;
	userId: string;
	server: BenchmarkHttpServer;
	providerId: SandboxProviderId;
	entitySchemaSlug: EntitySchemaSlug;
}) =>
	Effect.gen(function* () {
		const stats = { failed: 0, started: 0, completed: 0 };
		const progress: LatencyTrialRecord["background"]["progress"][number][] = [];
		const startGate = Effect.suspend(() =>
			startMediaPopulationGate({
				providerId: input.providerId,
				executingUserId: input.userId,
				itemCount: BACKGROUND_GATE_ITEM_COUNT,
				entitySchemaSlug: input.entitySchemaSlug,
				identifierPrefix: `s3-bg-${stats.started++}`,
			}),
		);
		yield* Effect.gen(function* () {
			let active = yield* Effect.forEach(Array.from({ length: input.gates }), () => startGate);
			for (;;) {
				yield* Effect.sleep("1 second");
				const next: typeof active = [];
				for (const run of active) {
					const result = yield* getMediaPopulationGateResult(run);
					if (result.executions.some(({ status }) => status === "pending")) {
						next.push(run);
						continue;
					}
					stats.completed += 1;
					if (result.executions.some(({ status }) => status === "failed")) {
						stats.failed += 1;
					}
					next.push(yield* startGate);
				}
				active = next;
			}
		}).pipe(Effect.forkScoped);
		yield* Effect.gen(function* () {
			yield* Effect.sleep("1 second");
			progress.push({
				gatesCompleted: stats.completed,
				atMs: yield* Clock.currentTimeMillis,
				httpRequests: input.server.backgroundRequests(),
			});
		}).pipe(Effect.forever, Effect.forkScoped);
		return { stats, progress };
	});

// Background imports spend long stretches persisting without outbound HTTP, so progress is measured
// where the queue hands background work out.
export const backgroundStall = (
	metrics: ReadonlyArray<MetricSnapshot>,
	fromMs: number,
	toMs: number,
) => {
	let lastAdvance = fromMs;
	let maxStall = 0;
	let previous: number | undefined;
	for (const { atMs, metrics: points } of metrics) {
		const dispatched = points["ryot.durable_queue.dispatches"]?.find(
			({ attributes }) => attributes.lane === "background",
		)?.value;
		if (dispatched === undefined || dispatched === null) {
			continue;
		}
		if (atMs > fromMs && previous !== undefined && dispatched > previous) {
			maxStall = Math.max(maxStall, Math.min(atMs, toMs) - lastAdvance);
			lastAdvance = Math.min(atMs, toMs);
		}
		previous = dispatched;
	}
	return Math.max(maxStall, toMs - lastAdvance);
};

export const readMetricWindow = (otlpFile: string, startMs: number, endMs: number) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const text = yield* fs.readFileString(otlpFile);
		const decodeLine = Schema.decodeEffect(Schema.fromJsonString(MetricSnapshot));
		const snapshots = yield* Effect.forEach(
			text.split("\n").filter((line) => line.length > 0),
			(line) => decodeLine(line),
		);
		const before = snapshots.findLast(({ atMs }) => atMs <= startMs);
		const inside = snapshots.filter(({ atMs }) => atMs > startMs && atMs < endMs);
		const after = snapshots.find(({ atMs }) => atMs >= endMs);
		return [before, ...inside, after].filter(
			(snapshot): snapshot is MetricSnapshot => snapshot !== undefined,
		);
	});

export const benchmarkConfiguration = (
	parameters: BenchmarkParameters,
	policy: { intervalMs: number; requests: number },
) => ({
	...Schema.decodeSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)))(
		parameters.serverEnv,
	),
	warmup: parameters.warmup,
	platform: process.platform,
	stallLimitMs: STALL_LIMIT_MS,
	measured: parameters.measured,
	policyRequests: policy.requests,
	policyKey: S3_BENCHMARK_POLICY_KEY,
	policyIntervalMs: policy.intervalMs,
	cpuIterations: parameters.cpuIterations,
	saturationWindowMs: SATURATION_WINDOW_MS,
	saturationThreshold: SATURATION_THRESHOLD,
	backgroundGates: parameters.backgroundGates,
	detailsPollIntervalMs: DETAILS_POLL_INTERVAL_MS,
	backgroundGateItems: BACKGROUND_GATE_ITEM_COUNT,
});

export const writeBenchmarkRecord = <A, I>(schema: Schema.Codec<A, I>, record: A, path: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const text = yield* Schema.encodeEffect(Schema.fromJsonString(schema, { space: 2 }))(record);
		yield* fs.writeFileString(path, `${text}\n`);
	});

const AdmissionTimingLine = Schema.Struct({
	ticketWaitMs: Schema.FiniteFromString,
	resumeDelayMs: Schema.FiniteFromString,
	sandboxWorkflowExecutionId: Schema.String,
});

export type AdmissionTiming = {
	atMs: number;
	executionId: string;
	resumeDelayMs: number;
	ticketWaitMs: number;
};

const logfmtFields = (line: string) =>
	Object.fromEntries(
		[...line.matchAll(/(\w+)=("(?:[^"\\]|\\.)*"|\S+)/g)].map(([, key, value]) => [
			key,
			value?.startsWith('"') ? value.slice(1, -1) : value,
		]),
	);

export const readAdmissionTimings = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const decode = Schema.decodeUnknownEffect(AdmissionTimingLine);
	const text = yield* fs.readFileString(getServerLogFile());
	const timings: Array<AdmissionTiming> = [];
	for (const line of text.split("\n")) {
		if (!line.includes('message="sandbox HTTP admission timing"')) {
			continue;
		}
		const fields = logfmtFields(line);
		const parsed = yield* decode(fields);
		timings.push({
			ticketWaitMs: parsed.ticketWaitMs,
			resumeDelayMs: parsed.resumeDelayMs,
			atMs: Date.parse(String(fields.timestamp)),
			executionId: parsed.sandboxWorkflowExecutionId,
		});
	}
	return timings;
});

const SEARCH_EXECUTION_PREFIX = "provider-search-";

export const admissionForSearch = (
	timings: ReadonlyArray<AdmissionTiming>,
	window: { endMs: number; startMs: number },
) => {
	const matches = timings.filter(
		({ atMs, executionId }) =>
			executionId.startsWith(SEARCH_EXECUTION_PREFIX) &&
			atMs >= window.startMs &&
			atMs <= window.endMs,
	);
	return matches.length === 1 ? matches[0] : undefined;
};

export const admissionForExecution = (
	timings: ReadonlyArray<AdmissionTiming>,
	executionId: string,
) => {
	const matches = timings.filter((timing) => timing.executionId === executionId);
	return matches.length === 1 ? matches[0] : undefined;
};
