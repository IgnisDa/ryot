import { type SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { randomUuid } from "@ryot-app/testing/random";
import { Effect } from "effect";

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
import { runFileOnIsolatedServer } from "~/support/isolated-harness";

runFileOnIsolatedServer("Sandbox Short Wait Replay");

const workflowSource = (input: { name: string; slug: string; steps: number }) => `
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot-app/plugin-backend-sdk/workflow";
export const manifest = defineManifest({ kind: "workflow", name: ${JSON.stringify(input.name)}, slug: ${JSON.stringify(input.slug)} });
export default defineWorkflow({ manifest, input: Schema.Struct({}), output: Schema.Struct({ completed: Schema.Int }),
  checkpoint: Schema.Int,
  run: (_input, step, checkpoint) => {
    const completed = checkpoint ?? 0;
    return completed === ${input.steps} ? Effect.succeed({ completed }) : step.save(completed + 1);
  },
});
`;

const httpScriptSource = (input: {
	url: string;
	name: string;
	slug: string;
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
	"scope" | "client"
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
	it.live("saved_checkpoints_preserve_workflow_output", () =>
		Effect.gen(function* () {
			const pluginSlug = `e2e-short-wait-replay-${yield* randomUuid}`;
			const shortSlug = `workflow.short-wait-${yield* randomUuid}`;
			const longSlug = `workflow.long-wait-${yield* randomUuid}`;
			const shortEntry = `backend/scripts/${shortSlug}.sandbox.ts`;
			const longEntry = `backend/scripts/${longSlug}.sandbox.ts`;
			const plugin = yield* installSystemPluginScoped({
				pluginSlug,
				files: {
					[longEntry]: workflowSource({ steps: 20, slug: longSlug, name: "Twenty saved steps" }),
					[shortEntry]: workflowSource({ steps: 3, slug: shortSlug, name: "Three saved steps" }),
				},
				scripts: [
					{
						slug: shortSlug,
						kind: "workflow",
						capabilities: [],
						entry: shortEntry,
						name: "Three saved steps",
						requiredPluginConfigKeys: [],
					},
					{
						slug: longSlug,
						entry: longEntry,
						kind: "workflow",
						capabilities: [],
						name: "Twenty saved steps",
						requiredPluginConfigKeys: [],
					},
				],
			});

			const { userId } = yield* createAuthenticatedClient();
			const shortJob = yield* enqueueTrustedSandbox(
				userId,
				requirePresent(plugin.scriptIds[shortSlug], "Short workflow script was not installed"),
			);
			const shortOutput = requireCompletedSandboxValue(
				yield* pollSandboxResult(userId, shortJob.jobId),
				"three saved steps",
			);
			expect(shortOutput).toEqual({ completed: 3 });

			const longJob = yield* enqueueTrustedSandbox(
				userId,
				requirePresent(plugin.scriptIds[longSlug], "Long workflow script was not installed"),
			);
			const longOutput = requireCompletedSandboxValue(
				yield* pollSandboxResult(userId, longJob.jobId),
				"twenty saved steps",
			);
			expect(longOutput).toEqual({ completed: 20 });
		}),
	);

	it.live("matched_short_http_slots_preserve_request_spacing", () =>
		Effect.gen(function* () {
			const requestTimestamps: Array<number> = [];
			const http = yield* startFakeHttpServerScoped(() => {
				requestTimestamps.push(Date.now());
				return Response.json({ ok: true });
			});
			const suffix = yield* randomUuid;
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
			// Slots space when sends start; arrival adds connection and scheduling delay that differs per request.
			for (let index = 1; index < requestTimestamps.length; index += 1) {
				expect(
					requirePresent(requestTimestamps[index], "Missing request timestamp") -
						requirePresent(requestTimestamps[index - 1], "Missing previous request timestamp"),
				).toBeGreaterThanOrEqual(100);
			}
		}),
	);
});
