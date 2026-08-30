import os from "node:os";

import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	installTestPluginBundle,
	sampleSandboxRuntime,
	uninstallTestPlugin,
} from "~/fixtures/kernel";
import { assertCompleted, assertPresent } from "~/support/assertions";
import {
	average,
	percentile,
	runDirectSandboxSample,
	type RuntimeSample,
	summarizeRuntimeSamples,
	waitForSandboxIdle,
} from "~/support/benchmark-workload";
import { describe, expect, it } from "~/support/effect-test";
import { startFakeHttpServerScoped } from "~/support/fake-http-server";

const positiveIntegerEnv = (name: string, fallback: number, allowZero = false) => {
	const value = Number(process.env[name]);
	return Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1) ? value : fallback;
};

const UPSTREAM_DELAY_MS = 25;
const SAMPLE_COUNT = positiveIntegerEnv("SANDBOX_BENCHMARK_SAMPLES", 15);
const PROCESS_MODE = process.env.SANDBOX_PROCESS_MODE === "warm" ? "warm" : "on-demand";
const IDLE_SAMPLE_COUNT = positiveIntegerEnv("SANDBOX_BENCHMARK_IDLE_SAMPLES", 5);
const WARM_UP_COUNT = positiveIntegerEnv("SANDBOX_BENCHMARK_WARMUPS", 3, true);
const IDLE_SAMPLE_INTERVAL_MS = positiveIntegerEnv("SANDBOX_BENCHMARK_IDLE_INTERVAL_MS", 250);
const RUN_SANDBOX_BENCHMARKS =
	process.env.RUN_SANDBOX_BENCHMARKS === "1" || process.env.RUN_SANDBOX_BENCHMARKS === "true";

const AUTOMATION_FULL_SLUG = "benchmark.automation-full";
const PROVIDER_SEARCH_SLUG = "benchmark-provider.search";
const PROVIDER_DETAILS_SLUG = "benchmark-provider.details";
const AUTOMATION_NO_HOST_SLUG = "benchmark.automation-no-host";

type BenchmarkSample = {
	latencyMs: number;
	totalSpawned: number;
	workerRssBytes: number;
	sandboxExecutions: number;
	activeProcessCount: number;
	sandboxExecutionMs?: number;
};

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
	perSampleCounters: {
		totalSpawned: average(samples.map(({ totalSpawned }) => totalSpawned)),
		workerRssBytes: average(samples.map(({ workerRssBytes }) => workerRssBytes)),
		sandboxExecutions: average(samples.map(({ sandboxExecutions }) => sandboxExecutions)),
		activeProcessCount: average(samples.map(({ activeProcessCount }) => activeProcessCount)),
	},
});

const noHostAutomationSource = `
import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  capabilities: [],
  kind: "automation",
  automationType: "automation",
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  inputProjection: { event: { properties: [], compareProperties: [] } },
  name: "Benchmark no-host automation",
  slug: ${JSON.stringify(AUTOMATION_NO_HOST_SLUG)},
});

export default defineAutomation({
  manifest,
  run: ({ automation }) =>
    Effect.succeed(automation.payload.resource === "event" ? null : "unexpected-source"),
});
`;

const fullAutomationSource = `
import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "automation",
  automationType: "automation",
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  inputProjection: { event: { properties: [], compareProperties: [] } },
  name: "Benchmark full automation",
  slug: ${JSON.stringify(AUTOMATION_FULL_SLUG)},
  capabilities: ["getUserPreferences", "setCachedValue"],
});

export default defineAutomation({
  manifest,
  run: ({ automation }, host) => {
    if (automation.payload.resource !== "event") {
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
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

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
    const serverUrl = ${JSON.stringify(serverUrl)};
    yield* host.httpCall("GET", serverUrl + "/provider-first");
    yield* host.httpCall("GET", serverUrl + "/provider-second");
    return { items: [{ externalId: "benchmark", title: "Benchmark" }] };
  }),
});
`;

const youtubeiDetailsSource = (serverUrl: string) => `
import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";
import { createYoutubeMusicClient } from "@ryot-app/sandbox-sdk/youtubei";

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

const automationContext = (userId: string) => {
	const occurredAt = "2026-08-06T00:00:00.000Z";
	const executionId = crypto.randomUUID();
	return {
		automation: {
			occurredAt,
			executionUserId: userId,
			runId: crypto.randomUUID(),
			triggerId: crypto.randomUUID(),
			hookSlug: "benchmark.event-created",
			causation: {
				depth: 0,
				executionId,
				source: "api",
				parentRunId: null,
				parentTriggerId: null,
				rootExecutionId: executionId,
				initiator: { id: userId, kind: "user" },
			},
			payload: {
				resource: "event",
				category: "change",
				operation: "create",
				after: {
					occurredAt,
					properties: {},
					createdAt: occurredAt,
					updatedAt: occurredAt,
					sessionEntityId: null,
					id: crypto.randomUUID(),
					entityId: crypto.randomUUID(),
					eventSchemaSlug: "benchmark-event",
					entitySchemaSlug: "benchmark-entity",
				},
			},
		},
	};
};

const collectIdleRuntimeSamples = () =>
	Effect.gen(function* () {
		const samples: RuntimeSample[] = [];
		yield* waitForSandboxIdle(PROCESS_MODE);
		for (let index = 0; index < IDLE_SAMPLE_COUNT; index += 1) {
			samples.push(yield* sampleSandboxRuntime);
			if (index + 1 < IDLE_SAMPLE_COUNT) {
				yield* Effect.sleep(`${IDLE_SAMPLE_INTERVAL_MS} millis`);
			}
		}
		return samples;
	});

const runDirectSample = (input: Parameters<typeof runDirectSandboxSample>[0]) =>
	Effect.gen(function* () {
		const { after, before, result, latencyMs } = yield* runDirectSandboxSample(input);
		assertCompleted(result, "sandbox benchmark sample");
		expect(result.error).toBeNull();
		const timing = result.timing;
		assertPresent(timing, "Sandbox benchmark result did not include timing");
		return {
			latencyMs,
			sandboxExecutionMs: timing.totalMs,
			workerRssBytes: after.workerRssBytes,
			activeProcessCount: after.activeProcessCount,
			totalSpawned: after.totalSpawned - before.totalSpawned,
			sandboxExecutions: after.totalSpawned - before.totalSpawned,
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

describe.skipIf(!RUN_SANDBOX_BENCHMARKS)("sandbox runtime benchmark", () => {
	it.live(
		"records representative workloads",
		() =>
			Effect.gen(function* () {
				const unmatchedHttpServer = yield* startFakeHttpServerScoped(async () => {
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
						automationType: "automation" as const,
						entry: "backend/scripts/automation-no-host.sandbox.ts",
						inputProjection: { event: { properties: [], compareProperties: [] } },
					},
					{
						slug: AUTOMATION_FULL_SLUG,
						kind: "automation" as const,
						requiredPluginConfigKeys: [],
						requiredSystemConfigKeys: [],
						name: "Benchmark full automation",
						automationType: "automation" as const,
						entry: "backend/scripts/automation-full.sandbox.ts",
						capabilities: ["getUserPreferences", "setCachedValue"],
						inputProjection: { event: { properties: [], compareProperties: [] } },
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
						entry: "backend/providers/benchmark-provider/details.sandbox.ts",
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
						entry: "backend/providers/benchmark-provider/search.sandbox.ts",
					},
				] satisfies PluginManifest["scripts"];
				const { client, userId } = yield* createAuthenticatedClient();
				const benchmarkPlugin = yield* Effect.acquireRelease(
					installTestPluginBundle({
						client,
						scripts,
						pluginSlug: `sandbox-benchmark-${crypto.randomUUID()}`,
						providers: [
							{
								name: "Benchmark provider",
								slug: "benchmark-provider",
								rootEntitySchemaSlug: "book",
								information: { source: "benchmark" },
								operations: { search: PROVIDER_SEARCH_SLUG, details: PROVIDER_DETAILS_SLUG },
							},
						],
						files: {
							"backend/scripts/automation-full.sandbox.ts": fullAutomationSource,
							"backend/scripts/automation-no-host.sandbox.ts": noHostAutomationSource,
							"backend/providers/benchmark-provider/search.sandbox.ts": providerSearchSource(
								unmatchedHttpServer.url,
							),
							"backend/providers/benchmark-provider/details.sandbox.ts": youtubeiDetailsSource(
								unmatchedHttpServer.url,
							),
						},
					}),
					uninstallTestPlugin,
				);
				const scriptId = (slug: string) => {
					const id = benchmarkPlugin.scriptIds[slug];
					assertPresent(id, `Benchmark script '${slug}' was not installed`);
					return id;
				};
				const idleRuntime = yield* collectIdleRuntimeSamples();
				if (PROCESS_MODE === "warm") {
					expect(idleRuntime[0]?.activeProcessCount).toBeGreaterThan(0);
				} else {
					expect(idleRuntime[0]?.activeProcessCount).toBe(0);
					expect(idleRuntime[0]?.workers).toHaveLength(0);
				}
				const noHost = yield* collectSamples(
					WARM_UP_COUNT,
					SAMPLE_COUNT,
					runDirectSample({
						userId,
						context: automationContext(userId),
						scriptId: scriptId(AUTOMATION_NO_HOST_SLUG),
					}),
				);
				const fullAutomation = yield* collectSamples(
					WARM_UP_COUNT,
					SAMPLE_COUNT,
					runDirectSample({
						userId,
						context: automationContext(userId),
						scriptId: scriptId(AUTOMATION_FULL_SLUG),
					}),
				);
				const controlledHttpProvider = yield* collectSamples(
					WARM_UP_COUNT,
					SAMPLE_COUNT,
					runDirectSample({
						userId,
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
						scriptId: scriptId(PROVIDER_DETAILS_SLUG),
					}),
				);

				expect(unmatchedHttpServer.requests.length).toBe((WARM_UP_COUNT + SAMPLE_COUNT) * 4);
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
								processMode: PROCESS_MODE,
								sampleCount: SAMPLE_COUNT,
								warmUpCount: WARM_UP_COUNT,
								idleSampleCount: IDLE_SAMPLE_COUNT,
								fixedUpstreamDelayMs: UPSTREAM_DELAY_MS,
								idleSampleIntervalMs: IDLE_SAMPLE_INTERVAL_MS,
							},
							workloads: {
								noHostAutomation: summarize(noHost),
								youtubeiProvider: summarize(youtubei),
								fullAutomation: summarize(fullAutomation),
								idleRuntime: summarizeRuntimeSamples(idleRuntime),
								controlledHttpProvider: summarize(controlledHttpProvider),
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
