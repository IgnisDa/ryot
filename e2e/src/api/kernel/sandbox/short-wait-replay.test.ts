import { type SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { Clock, Effect } from "effect";

import {
	createAuthenticatedClient,
	getApiClient,
	installTestPluginBundle,
	pollSandboxResult,
	requireCompletedSandboxValue,
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
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot-app/plugin-backend-sdk/workflow";

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
import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

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
	getApiClient().adminCall((client) =>
		client.testSupport.enqueueSandbox({
			payload: { scriptId, lane: "interactive", executingUserId: UserId.make(userId) },
		}),
	);

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
