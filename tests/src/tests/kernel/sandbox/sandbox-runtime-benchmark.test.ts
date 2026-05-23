import os from "node:os";

import { UserId } from "@ryot/contract/schema/brands";
import { Clock, Effect } from "effect";

import {
	adminHeaders,
	createAuthenticatedClient,
	enqueueSandboxScript,
	fakeProviderDetailsResult,
	findBuiltinSchemaBySlug,
	getBackendClient,
	getMediaPopulationGateResult,
	installTestPluginBundle,
	installTestProvider,
	sampleOperationalPressure,
	startMediaPopulationGate,
	uninstallTestPlugin,
	uninstallTestProvider,
} from "~/fixtures";
import { assertCompleted, assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { startFakeHttpServerScoped } from "~/support/fake-http-server";

const positiveIntegerEnv = (name: string, fallback: number, allowZero = false) => {
	const value = Number(process.env[name]);
	return Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1) ? value : fallback;
};

const SAMPLE_COUNT = positiveIntegerEnv("SANDBOX_BENCHMARK_SAMPLES", 15);
const WARM_UP_COUNT = positiveIntegerEnv("SANDBOX_BENCHMARK_WARMUPS", 3, true);
const IMPORT_ITEM_COUNT = positiveIntegerEnv("SANDBOX_BENCHMARK_IMPORT_ITEMS", 10);
const IMPORT_SAMPLE_COUNT = positiveIntegerEnv("SANDBOX_BENCHMARK_IMPORT_SAMPLES", 5);
const IMPORT_WARM_UP_COUNT = positiveIntegerEnv("SANDBOX_BENCHMARK_IMPORT_WARMUPS", 1, true);
const UPSTREAM_DELAY_MS = 25;
const POLL_INTERVAL = "10 millis";
const RUN_SANDBOX_BENCHMARKS =
	process.env.RUN_SANDBOX_BENCHMARKS === "1" || process.env.RUN_SANDBOX_BENCHMARKS === "true";

const AUTOMATION_NO_HOST_SLUG = "benchmark.automation-no-host";
const AUTOMATION_FULL_SLUG = "benchmark.automation-full";
const PROVIDER_DETAILS_SLUG = "benchmark-provider.details";
const PROVIDER_SEARCH_SLUG = "benchmark-provider.search";

type BenchmarkSample = {
	latencyMs: number;
	moduleLoads: number;
	bodyReplays: number;
	orchestrationMs: number;
	itemsPerSecond?: number;
	sandboxExecutions: number;
	sandboxExecutionMs?: number;
	redisProjectionKeys: number;
	maxWorkflowActivityChildRoundTrips: number;
};

const percentile = (values: ReadonlyArray<number>, ratio: number) => {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
};

const average = (values: ReadonlyArray<number>) =>
	values.reduce((total, value) => total + value, 0) / values.length;

const summarize = (samples: ReadonlyArray<BenchmarkSample>) => ({
	sampleCount: samples.length,
	latencyMs: {
		p50: percentile(
			samples.map(({ latencyMs }) => latencyMs),
			0.5,
		),
		p95: percentile(
			samples.map(({ latencyMs }) => latencyMs),
			0.95,
		),
	},
	orchestrationMs: {
		p50: percentile(
			samples.map(({ orchestrationMs }) => orchestrationMs),
			0.5,
		),
		p95: percentile(
			samples.map(({ orchestrationMs }) => orchestrationMs),
			0.95,
		),
	},
	...(samples[0]?.sandboxExecutionMs === undefined
		? {}
		: {
				sandboxExecutionMs: {
					p50: percentile(
						samples.flatMap(({ sandboxExecutionMs }) => sandboxExecutionMs ?? []),
						0.5,
					),
					p95: percentile(
						samples.flatMap(({ sandboxExecutionMs }) => sandboxExecutionMs ?? []),
						0.95,
					),
				},
			}),
	...(samples[0]?.itemsPerSecond === undefined
		? {}
		: {
				itemsPerSecond: {
					p50: percentile(
						samples.flatMap(({ itemsPerSecond }) => itemsPerSecond ?? []),
						0.5,
					),
					p95: percentile(
						samples.flatMap(({ itemsPerSecond }) => itemsPerSecond ?? []),
						0.95,
					),
				},
			}),
	perSampleCounters: {
		moduleLoads: average(samples.map(({ moduleLoads }) => moduleLoads)),
		bodyReplays: average(samples.map(({ bodyReplays }) => bodyReplays)),
		sandboxExecutions: average(samples.map(({ sandboxExecutions }) => sandboxExecutions)),
		redisProjectionKeys: average(samples.map(({ redisProjectionKeys }) => redisProjectionKeys)),
		maxWorkflowActivityChildRoundTrips: average(
			samples.map(({ maxWorkflowActivityChildRoundTrips }) => maxWorkflowActivityChildRoundTrips),
		),
	},
});

const noHostAutomationSource = `
import { defineAutomation } from "@ryot/sandbox-sdk/automation";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

export const manifest = defineManifest({
  capabilities: [],
  kind: "automation",
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  name: "Benchmark no-host automation",
  slug: ${JSON.stringify(AUTOMATION_NO_HOST_SLUG)},
});

export default defineAutomation({
  manifest,
  run: ({ automation }) => automation.source.kind !== "event" ||
    automation.source.after?.properties["progressPercent"] !== 100
      ? Effect.succeed(null)
      : Effect.succeed("unexpected-full-branch"),
});
`;

const fullAutomationSource = `
import { defineAutomation } from "@ryot/sandbox-sdk/automation";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "automation",
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  name: "Benchmark full automation",
  slug: ${JSON.stringify(AUTOMATION_FULL_SLUG)},
  capabilities: ["getUserPreferences", "setCachedValue"],
});

export default defineAutomation({
  manifest,
  run: ({ automation }, host) => {
    if (automation.source.kind !== "event" ||
      automation.source.after?.properties["progressPercent"] !== 100) {
      return Effect.succeed(null);
    }
    return Effect.gen(function* () {
      const preferences = yield* host.getUserPreferences();
      yield* host.setCachedValue("sandbox-benchmark-full-automation", preferences, 60);
      return { disableIntegrations: preferences.disableIntegrations };
    });
  },
});
`;

const providerSearchSource = (serverUrl: string) => `
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

export const manifest = defineManifest({
  kind: "provider",
  capabilities: ["httpCall"],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  name: "Benchmark controlled HTTP provider",
  slug: ${JSON.stringify(PROVIDER_SEARCH_SLUG)},
});

export default defineProvider({
  manifest,
  operation: "search",
  run: (_input, host) => Effect.gen(function* () {
    yield* host.httpCall("GET", ${JSON.stringify(`${serverUrl}/provider-first`)});
    yield* host.httpCall("GET", ${JSON.stringify(`${serverUrl}/provider-second`)});
    return { items: [{ externalId: "benchmark", titleProperty: { kind: "text", value: "Benchmark" } }] };
  }),
});
`;

const youtubeiDetailsSource = (serverUrl: string) => `
import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider } from "@ryot/sandbox-sdk/provider";
import { createYoutubeMusicClient } from "@ryot/sandbox-sdk/youtubei";

export const manifest = defineManifest({
  kind: "provider",
  capabilities: ["httpCall"],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  name: "Benchmark Youtubei provider",
  slug: ${JSON.stringify(PROVIDER_DETAILS_SLUG)},
});

export default defineProvider({
  manifest,
  operation: "details",
  run: (_input, host) => Effect.gen(function* () {
    const youtubeHost: SandboxHost<readonly ["httpCall"]> = {
      httpCall: (method: string, url: string, options?: {
        readonly body?: string | undefined;
        readonly allowInsecureConnections?: boolean | undefined;
        readonly headers?: Readonly<Record<string, string>> | undefined;
      }) => {
        const target = new URL(url, "https://www.youtube.com");
        return host.httpCall(method, ${JSON.stringify(serverUrl)} + target.pathname, options);
      },
    };
    const client = yield* createYoutubeMusicClient(youtubeHost, undefined, {
      retrievePlayer: false,
      retrieveInnertubeConfig: false,
    });
    const first = yield* Effect.tryPromise(() => client.actions.execute("/benchmark-first", { value: 1 })).pipe(
      Effect.mapError((error) => new Error("Youtubei first request failed: " + String(error.cause))),
    );
    const second = yield* Effect.tryPromise(() => client.actions.execute("/benchmark-second", { value: 2 })).pipe(
      Effect.mapError((error) => new Error("Youtubei second request failed: " + String(error.cause))),
    );
    return {
      name: "Youtubei benchmark",
      properties: { statuses: [first.status_code, second.status_code] },
    };
  }),
});
`;

const automationContext = (progressPercent: number) => ({
	automation: {
		operation: "create",
		origin: { kind: "api" },
		ruleId: "benchmark-rule",
		occurrenceId: crypto.randomUUID(),
		occurredAt: "2026-08-06T00:00:00.000Z",
		source: {
			kind: "event",
			after: {
				id: crypto.randomUUID(),
				eventSchemaSlug: "progress",
				properties: { progressPercent },
				occurredAt: "2026-08-06T00:00:00.000Z",
				subject: {
					id: crypto.randomUUID(),
					name: "Benchmark entity",
					entitySchemaSlug: "benchmark",
				},
			},
		},
	},
});

const pollSandboxResult = (executingUserId: string, jobId: string) =>
	Effect.gen(function* () {
		for (;;) {
			const result = yield* getBackendClient().call(
				(client) =>
					client.testSupport.getSandboxResult({
						params: { jobId },
						query: { executingUserId: UserId.make(executingUserId) },
					}),
				adminHeaders,
			);
			if (result.status !== "pending") {
				return result;
			}
			yield* Effect.sleep(POLL_INTERVAL);
		}
	});

const runDirectSample = (input: {
	userId: string;
	context: unknown;
	upstreamDelayMs: number;
	scriptId: Parameters<typeof enqueueSandboxScript>[1]["scriptId"];
}) =>
	Effect.gen(function* () {
		const before = yield* sampleOperationalPressure([`benchmark-direct-${crypto.randomUUID()}`]);
		const startedAt = yield* Clock.currentTimeMillis;
		const { executionId, jobId } = yield* enqueueSandboxScript(input.userId, {
			context: input.context,
			scriptId: input.scriptId,
		});
		const result = yield* pollSandboxResult(input.userId, jobId);
		const latencyMs = (yield* Clock.currentTimeMillis) - startedAt;
		const after = yield* sampleOperationalPressure([executionId]);
		assertCompleted(result, "sandbox benchmark sample");
		expect(result.error).toBeNull();
		assertPresent(result.timing, "Sandbox benchmark result did not include timing");
		const sandboxExecutions = after.sandbox.totalExecutions - before.sandbox.totalExecutions;
		return {
			latencyMs,
			sandboxExecutions,
			bodyReplays: sandboxExecutions,
			moduleLoads: sandboxExecutions,
			...(result.timing ? { sandboxExecutionMs: result.timing.totalMs } : {}),
			orchestrationMs: Math.max(0, latencyMs - input.upstreamDelayMs),
			maxWorkflowActivityChildRoundTrips: after.redis.maxHighWater,
			redisProjectionKeys: Math.max(0, after.redis.projectionCount - before.redis.projectionCount),
		} satisfies BenchmarkSample;
	});

const runPopulationSample = (input: {
	userId: string;
	providerId: Parameters<typeof startMediaPopulationGate>[0]["providerId"];
	entitySchemaSlug: Parameters<typeof startMediaPopulationGate>[0]["entitySchemaSlug"];
}) =>
	Effect.gen(function* () {
		const before = yield* sampleOperationalPressure([
			`benchmark-population-${crypto.randomUUID()}`,
		]);
		const startedAt = yield* Clock.currentTimeMillis;
		const run = yield* startMediaPopulationGate({
			itemCount: IMPORT_ITEM_COUNT,
			providerId: input.providerId,
			executingUserId: input.userId,
			entitySchemaSlug: input.entitySchemaSlug,
			identifierPrefix: `benchmark-${crypto.randomUUID()}`,
		});
		let result = yield* getMediaPopulationGateResult(run);
		while (result.executions.some(({ status }) => status === "pending")) {
			yield* Effect.sleep(POLL_INTERVAL);
			result = yield* getMediaPopulationGateResult(run);
		}
		const latencyMs = (yield* Clock.currentTimeMillis) - startedAt;
		const after = yield* sampleOperationalPressure(run.executionIds);
		expect(result.executions.every(({ status }) => status === "completed")).toBe(true);
		const sandboxExecutions = after.sandbox.totalExecutions - before.sandbox.totalExecutions;
		return {
			latencyMs,
			sandboxExecutions,
			orchestrationMs: latencyMs,
			bodyReplays: sandboxExecutions,
			moduleLoads: sandboxExecutions,
			redisProjectionKeys: after.redis.projectionCount,
			itemsPerSecond: IMPORT_ITEM_COUNT / (latencyMs / 1_000),
			maxWorkflowActivityChildRoundTrips: after.redis.maxHighWater,
		} satisfies BenchmarkSample;
	});

const collectSamples = <A, E, R>(
	warmUpCount: number,
	sampleCount: number,
	run: Effect.Effect<A, E, R>,
) =>
	Effect.gen(function* () {
		for (let index = 0; index < warmUpCount; index += 1) {
			yield* run;
		}
		return yield* Effect.all(
			Array.from({ length: sampleCount }, () => run),
			{ concurrency: 1 },
		);
	});

describe.skipIf(!RUN_SANDBOX_BENCHMARKS)("current sandbox runtime benchmark", () => {
	it.live(
		"records warm hermetic representative workloads",
		() =>
			Effect.gen(function* () {
				const httpServer = yield* startFakeHttpServerScoped(async () => {
					await Bun.sleep(UPSTREAM_DELAY_MS);
					return Response.json({ ok: true });
				});
				const scripts = [
					{
						capabilities: [],
						kind: "automation" as const,
						requiredPluginConfigKeys: [],
						requiredSystemConfigKeys: [],
						slug: AUTOMATION_NO_HOST_SLUG,
						name: "Benchmark no-host automation",
						entry: "scripts/automation-no-host.sandbox.ts",
					},
					{
						slug: AUTOMATION_FULL_SLUG,
						kind: "automation" as const,
						requiredPluginConfigKeys: [],
						requiredSystemConfigKeys: [],
						name: "Benchmark full automation",
						entry: "scripts/automation-full.sandbox.ts",
						capabilities: ["getUserPreferences", "setCachedValue"],
					},
					{
						kind: "provider" as const,
						capabilities: ["httpCall"],
						slug: PROVIDER_DETAILS_SLUG,
						requiredPluginConfigKeys: [],
						requiredSystemConfigKeys: [],
						providerSlug: "benchmark-provider",
						name: "Benchmark Youtubei provider",
						providerOperation: "details" as const,
						entry: "scripts/provider-details.sandbox.ts",
					},
					{
						kind: "provider" as const,
						slug: PROVIDER_SEARCH_SLUG,
						capabilities: ["httpCall"],
						requiredPluginConfigKeys: [],
						requiredSystemConfigKeys: [],
						providerSlug: "benchmark-provider",
						providerOperation: "search" as const,
						name: "Benchmark controlled HTTP provider",
						entry: "scripts/provider-search.sandbox.ts",
					},
				];
				const benchmarkPlugin = yield* Effect.acquireRelease(
					installTestPluginBundle({
						scripts,
						pluginSlug: `sandbox-benchmark-${crypto.randomUUID()}`,
						files: {
							"scripts/automation-full.sandbox.ts": fullAutomationSource,
							"scripts/automation-no-host.sandbox.ts": noHostAutomationSource,
							"scripts/provider-search.sandbox.ts": providerSearchSource(httpServer.url),
							"scripts/provider-details.sandbox.ts": youtubeiDetailsSource(httpServer.url),
						},
						providers: [
							{
								name: "Benchmark provider",
								slug: "benchmark-provider",
								information: { source: "benchmark" },
								operations: { search: PROVIDER_SEARCH_SLUG, details: PROVIDER_DETAILS_SLUG },
							},
						],
					}),
					uninstallTestPlugin,
				);
				const { client, userId } = yield* createAuthenticatedClient();
				const { schema } = yield* findBuiltinSchemaBySlug(client, "book");
				const importProvider = yield* Effect.acquireRelease(
					installTestProvider({
						client,
						linkToEntitySchemaSlug: schema.id,
						details: fakeProviderDetailsResult({
							properties: {},
							name: "Benchmark population item",
						}),
					}),
					uninstallTestProvider,
				);
				const scriptId = (slug: string) => {
					const id = benchmarkPlugin.scriptIds[slug];
					assertPresent(id, `Benchmark script '${slug}' was not installed`);
					return id;
				};
				const noHost = yield* collectSamples(
					WARM_UP_COUNT,
					SAMPLE_COUNT,
					runDirectSample({
						userId,
						upstreamDelayMs: 0,
						context: automationContext(50),
						scriptId: scriptId(AUTOMATION_NO_HOST_SLUG),
					}),
				);
				const fullAutomation = yield* collectSamples(
					WARM_UP_COUNT,
					SAMPLE_COUNT,
					runDirectSample({
						userId,
						upstreamDelayMs: 0,
						scriptId: scriptId(AUTOMATION_FULL_SLUG),
						context: automationContext(100),
					}),
				);
				const provider = yield* collectSamples(
					WARM_UP_COUNT,
					SAMPLE_COUNT,
					runDirectSample({
						userId,
						upstreamDelayMs: UPSTREAM_DELAY_MS * 2,
						scriptId: scriptId(PROVIDER_SEARCH_SLUG),
						context: { page: 1, pageSize: 1, query: "benchmark" },
					}),
				);
				const youtubei = yield* collectSamples(
					WARM_UP_COUNT,
					SAMPLE_COUNT,
					runDirectSample({
						userId,
						context: { externalId: "benchmark" },
						upstreamDelayMs: UPSTREAM_DELAY_MS * 2,
						scriptId: scriptId(PROVIDER_DETAILS_SLUG),
					}),
				);
				const population = yield* collectSamples(
					IMPORT_WARM_UP_COUNT,
					IMPORT_SAMPLE_COUNT,
					runPopulationSample({
						userId,
						entitySchemaSlug: schema.id,
						providerId: importProvider.providerId,
					}),
				);

				expect(httpServer.requests.length).toBe((WARM_UP_COUNT + SAMPLE_COUNT) * 4);
				yield* Effect.log(
					"SANDBOX_RUNTIME_BASELINE",
					JSON.stringify(
						{
							machine: {
								arch: os.arch(),
								platform: os.platform(),
								bunVersion: Bun.version,
								cpuCount: os.cpus().length,
								totalMemoryBytes: os.totalmem(),
								cpuModel: os.cpus()[0]?.model ?? "unknown",
							},
							configuration: {
								warmBackend: true,
								warmSandboxPool: true,
								sampleCount: SAMPLE_COUNT,
								warmUpCount: WARM_UP_COUNT,
								importItemCount: IMPORT_ITEM_COUNT,
								importSampleCount: IMPORT_SAMPLE_COUNT,
								importWarmUpCount: IMPORT_WARM_UP_COUNT,
								fixedUpstreamDelayMs: UPSTREAM_DELAY_MS,
								workflowRedisCounterCaveat:
									"The current runtime exposes journal projection keys and maximum high-water only; exact workflow-engine and Redis transport round trips are not instrumented without changing production runtime code.",
							},
							workloads: {
								noHostAutomation: summarize(noHost),
								youtubeiProvider: summarize(youtubei),
								boundedPopulation: summarize(population),
								fullAutomation: summarize(fullAutomation),
								controlledHttpProvider: summarize(provider),
							},
						},
						null,
						2,
					),
				);
			}),
		900_000,
	);
});
