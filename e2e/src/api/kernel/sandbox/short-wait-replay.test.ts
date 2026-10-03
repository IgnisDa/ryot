import { type SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Config, Clock, Effect } from "effect";

import {
	adminHeaders,
	createAuthenticatedClient,
	getApiClient,
	installTestPluginBundle,
	pollSandboxResult,
	requireCompletedSandboxValue,
	sampleOperationalPressure,
	uninstallTestPlugin,
} from "~/fixtures/kernel";
import { requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { startFakeHttpServerScoped } from "~/support/fake-http-server";

const workflowSource = (input: {
	name: string;
	slug: string;
	sleepDurations: ReadonlyArray<number>;
}) => {
	const sleeps = input.sleepDurations
		.map((duration, index) => `yield* replay.sleep("sleep-${index + 1}", ${duration});`)
		.join("\n");
	return `
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot-app/sandbox-sdk/workflow";

export const manifest = defineManifest({
  kind: "workflow",
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
});

export default defineWorkflow({
  manifest,
  input: Schema.Struct({}),
  output: Schema.Struct({ completed: Schema.Number }),
  run: (_input, replay) => Effect.gen(function* () {
    ${sleeps}
    return { completed: ${input.sleepDurations.length} };
  }),
});
`;
};

const httpScriptSource = (input: {
	name: string;
	slug: string;
	url: string;
	requestCount: number;
}) => `
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
  output: Schema.Struct({ completed: Schema.Number }),
  run: (_input, host) => Effect.gen(function* () {
    for (let index = 0; index < ${input.requestCount}; index += 1) {
      yield* host.httpCall("GET", ${JSON.stringify(input.url)}, { allowInsecureConnections: true });
    }
    return { completed: ${input.requestCount} };
  }),
});
`;

type SystemPluginBundleInput = Omit<
	Parameters<typeof installTestPluginBundle>[0],
	"client" | "scope"
>;

const installSystemPluginScoped = (input: SystemPluginBundleInput) =>
	Effect.acquireRelease(
		installTestPluginBundle({ ...input, scope: "system" }),
		uninstallTestPlugin,
	);

const enqueueTrustedSandbox = (userId: string, scriptId: SandboxScriptId) =>
	getApiClient().call(
		(client) =>
			client.testSupport.enqueueSandbox({
				payload: { scriptId, lane: "interactive", executingUserId: UserId.make(userId) },
			}),
		adminHeaders(),
	);

const runBenchmarkWorkload = (input: {
	userId: string;
	scriptId: SandboxScriptId;
	workload: string;
	sourceHash: string;
}) =>
	Effect.gen(function* () {
		const backendPid = yield* Config.Int("E2E_SERVER_PID");
		yield* Effect.logInfo(
			`sandbox-replay-benchmark-start ${stableStringify({ backendPid, workload: input.workload })}`,
		);
		const before = yield* sampleOperationalPressure([`${input.workload}-baseline`]);
		const startedAt = yield* Clock.currentTimeMillis;
		const job = yield* enqueueTrustedSandbox(input.userId, input.scriptId);
		const output = requireCompletedSandboxValue(
			yield* pollSandboxResult(input.userId, job.jobId),
			input.workload,
		);
		const finishedAt = yield* Clock.currentTimeMillis;
		const after = yield* sampleOperationalPressure([job.executionId]);
		const wallMs = finishedAt - startedAt;
		yield* Effect.logInfo(
			`sandbox-replay-benchmark-result ${stableStringify({
				wallMs,
				output,
				workload: input.workload,
				pressure: { after, before },
				sourceHash: input.sourceHash,
				sandboxExecutions: after.sandbox.totalExecutions - before.sandbox.totalExecutions,
			})}`,
		);
		return output;
	});

describe("sandbox short waits and replay", () => {
	it.live("short_and_long_sleeps_preserve_workflow_output", () =>
		Effect.gen(function* () {
			const pluginSlug = `e2e-short-wait-replay-${crypto.randomUUID()}`;
			const shortSlug = `workflow.short-wait-${crypto.randomUUID()}`;
			const longSlug = `workflow.long-wait-${crypto.randomUUID()}`;
			const shortEntry = `backend/scripts/${shortSlug}.sandbox.ts`;
			const longEntry = `backend/scripts/${longSlug}.sandbox.ts`;
			const plugin = yield* installSystemPluginScoped({
				pluginSlug,
				files: {
					[longEntry]: workflowSource({
						slug: longSlug,
						name: "Long workflow waits",
						sleepDurations: [100, 1_250],
					}),
					[shortEntry]: workflowSource({
						slug: shortSlug,
						name: "Short workflow waits",
						sleepDurations: [250, 250, 250],
					}),
				},
				scripts: [
					{
						slug: shortSlug,
						kind: "workflow",
						capabilities: [],
						entry: shortEntry,
						name: "Short workflow waits",
						requiredPluginConfigKeys: [],
					},
					{
						slug: longSlug,
						entry: longEntry,
						kind: "workflow",
						capabilities: [],
						name: "Long workflow waits",
						requiredPluginConfigKeys: [],
					},
				],
			});

			const { userId } = yield* createAuthenticatedClient();
			const shortStartedAt = yield* Clock.currentTimeMillis;
			const shortJob = yield* enqueueTrustedSandbox(
				userId,
				requirePresent(plugin.scriptIds[shortSlug], "Short workflow script was not installed"),
			);
			const shortOutput = requireCompletedSandboxValue(
				yield* pollSandboxResult(userId, shortJob.jobId),
				"short workflow waits",
			);
			const shortWallMs = (yield* Clock.currentTimeMillis) - shortStartedAt;
			expect(shortOutput).toEqual({ completed: 3 });
			expect(shortWallMs).toBeGreaterThanOrEqual(750);

			const longStartedAt = yield* Clock.currentTimeMillis;
			const longJob = yield* enqueueTrustedSandbox(
				userId,
				requirePresent(plugin.scriptIds[longSlug], "Long workflow script was not installed"),
			);
			const longOutput = requireCompletedSandboxValue(
				yield* pollSandboxResult(userId, longJob.jobId),
				"long workflow waits",
			);
			const longWallMs = (yield* Clock.currentTimeMillis) - longStartedAt;
			expect(longOutput).toEqual({ completed: 2 });
			expect(longWallMs).toBeGreaterThanOrEqual(1_350);
		}),
	);

	it.live("matched_short_http_slots_preserve_request_spacing", () =>
		Effect.gen(function* () {
			const requestTimestamps: Array<number> = [];
			const http = yield* startFakeHttpServerScoped(() => {
				requestTimestamps.push(Date.now());
				return Response.json({ ok: true });
			});
			const suffix = crypto.randomUUID();
			const pluginSlug = `e2e-short-http-slots-${suffix}`;
			const scriptSlug = `short-http-slots-${suffix}`;
			const entry = `backend/scripts/${scriptSlug}.sandbox.ts`;
			const plugin = yield* installSystemPluginScoped({
				pluginSlug,
				files: {
					[entry]: httpScriptSource({
						url: http.url,
						requestCount: 3,
						slug: scriptSlug,
						name: "Matched short HTTP slots",
					}),
				},
				httpRateLimits: [
					{
						requests: 1,
						intervalMs: 150,
						origins: [new URL(http.url).origin],
						key: `e2e.short-http-slots.${suffix}`,
					},
				],
				scripts: [
					{
						entry,
						kind: "script",
						slug: scriptSlug,
						capabilities: ["httpCall"],
						requiredPluginConfigKeys: [],
						name: "Matched short HTTP slots",
					},
				],
			});
			const { userId } = yield* createAuthenticatedClient();
			const job = yield* enqueueTrustedSandbox(
				userId,
				requirePresent(plugin.scriptIds[scriptSlug], "HTTP script was not installed"),
			);

			expect(
				requireCompletedSandboxValue(
					yield* pollSandboxResult(userId, job.jobId),
					"matched short HTTP slots",
				),
			).toEqual({ completed: 3 });
			expect(http.requests).toHaveLength(3);
			expect(requestTimestamps).toHaveLength(3);
			for (let index = 1; index < requestTimestamps.length; index += 1) {
				expect(
					requirePresent(requestTimestamps[index], "Missing request timestamp") -
						requirePresent(requestTimestamps[index - 1], "Missing previous request timestamp"),
				).toBeGreaterThanOrEqual(140);
			}
		}),
	);
});

describe.skipIf(process.env.SANDBOX_REPLAY_BENCHMARK !== "1")("sandbox replay benchmark", () => {
	it.live("short_wait_workload_records_replays_time_and_memory", () =>
		Effect.gen(function* () {
			const requestTimestamps: Array<number> = [];
			const http = yield* startFakeHttpServerScoped(() => {
				requestTimestamps.push(Date.now());
				return Response.json({ ok: true });
			});
			const suffix = crypto.randomUUID();
			const pluginSlug = `e2e-short-wait-benchmark-${suffix}`;
			const workflowSlug = `workflow.short-wait-benchmark-${suffix}`;
			const scriptSlug = `short-http-benchmark-${suffix}`;
			const workflowEntry = `backend/scripts/${workflowSlug}.sandbox.ts`;
			const scriptEntry = `backend/scripts/${scriptSlug}.sandbox.ts`;
			const plugin = yield* installSystemPluginScoped({
				pluginSlug,
				httpRateLimits: [
					{
						requests: 1,
						intervalMs: 50,
						origins: [new URL(http.url).origin],
						key: `e2e.short-wait-benchmark.${suffix}`,
					},
				],
				files: {
					[scriptEntry]: httpScriptSource({
						url: http.url,
						requestCount: 10,
						slug: scriptSlug,
						name: "Short HTTP benchmark script",
					}),
					[workflowEntry]: workflowSource({
						slug: workflowSlug,
						name: "Short wait benchmark workflow",
						sleepDurations: Array.from({ length: 10 }, () => 50),
					}),
				},
				scripts: [
					{
						kind: "workflow",
						capabilities: [],
						slug: workflowSlug,
						entry: workflowEntry,
						requiredPluginConfigKeys: [],
						name: "Short wait benchmark workflow",
					},
					{
						kind: "script",
						slug: scriptSlug,
						entry: scriptEntry,
						capabilities: ["httpCall"],
						requiredPluginConfigKeys: [],
						name: "Short HTTP benchmark script",
					},
				],
			});

			const { userId } = yield* createAuthenticatedClient();
			const workflowOutput = yield* runBenchmarkWorkload({
				userId,
				sourceHash: plugin.sourceHash,
				workload: "workflow-10x50ms-sleep",
				scriptId: requirePresent(
					plugin.scriptIds[workflowSlug],
					"Benchmark workflow was not installed",
				),
			});
			const scriptOutput = yield* runBenchmarkWorkload({
				userId,
				sourceHash: plugin.sourceHash,
				workload: "script-10x50ms-http-call",
				scriptId: requirePresent(
					plugin.scriptIds[scriptSlug],
					"Benchmark script was not installed",
				),
			});

			expect(workflowOutput).toEqual({ completed: 10 });
			expect(scriptOutput).toEqual({ completed: 10 });
			expect(http.requests).toHaveLength(10);
			expect(requestTimestamps).toHaveLength(10);
			for (let index = 1; index < requestTimestamps.length; index += 1) {
				expect(
					requirePresent(requestTimestamps[index], "Missing request timestamp") -
						requirePresent(requestTimestamps[index - 1], "Missing previous request timestamp"),
				).toBeGreaterThanOrEqual(40);
			}
			yield* Effect.logInfo(
				`sandbox-replay-benchmark-http-spacing ${stableStringify({
					spacingMs: requestTimestamps
						.slice(1)
						.map(
							(timestamp, index) =>
								timestamp -
								requirePresent(requestTimestamps[index], "Missing previous request timestamp"),
						),
				})}`,
			);
		}),
	);
});
