import { startFakeHttpServerScoped } from "@ryot-app/testing/fake-http-server";
import { randomUuid } from "@ryot-app/testing/random";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createRatedItem,
	deleteSandboxReplayProjection,
	enqueueSandboxScript,
	installTestPluginBundle,
	pollSandboxResult,
	pollUntil,
	ratedItemEntitySchema,
	requireCompletedSandboxValue,
	sampleOperationalPressure,
	uninstallTestPlugin,
} from "~/fixtures/kernel";
import { requireArray, requireObjectRecord, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const scriptSource = (input: { readonly name: string; readonly slug: string }) => `
import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { entityReadRecipe, executeRyotqlRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";

export const manifest = defineManifest({
  kind: "script",
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
});

export default defineScript({
  manifest,
  output: Schema.Unknown,
  input: Schema.Struct({
    entityId: Schema.String,
    successUrl: Schema.String,
    failureUrl: Schema.String,
  }),
  run: (input, host, execution) => Effect.gen(function* () {
    yield* host.log([{ level: "info", message: "durable tracer started" }]);
    const preferences = yield* host.getUserPreferences();
     const { items: rows } = yield* executeRyotqlRecipe(host.executeRyotql, entityReadRecipe, { entityIds: [input.entityId] });
    const claim = yield* host.claimPersistentValue(
      "durable-tracer-" + input.entityId,
      { executionId: execution.sandboxScriptId },
      3600,
    );
    const http = yield* host.httpCall("GET", input.successUrl);
    const failure = yield* host.httpCall("GET", input.failureUrl).pipe(
      Effect.catch((error) => Effect.succeed({ message: error.message, data: error.data })),
    );
    const parallel = yield* Effect.all([
      host.getCachedValue("durable-tracer-a"),
      host.getCachedValue("durable-tracer-b"),
    ], { concurrency: "unbounded" });
    const child = yield* (host.executeWorkflow?.(
      "tracer-child",
      {
        workflowSlug: "tracer-child",
        referenceKind: "workflow" as const,
        input: Schema.Struct({ value: Schema.String }),
        output: Schema.String,
      },
      { value: input.entityId },
    ) ?? Effect.fail(new Error("executeWorkflow is unavailable")));
    yield* host.span([{ name: "durable.tracer.completed" }]);
    return {
      rows,
      http,
      child,
      claim,
      failure,
      parallel,
      preferences,
      startedAt: execution.startedAt,
    };
  }),
});
`;

const childSource = (input: { readonly name: string; readonly slug: string }) => `
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot-app/plugin-backend-sdk/workflow";

export const manifest = defineManifest({
  kind: "workflow",
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
});

export default defineWorkflow({
  manifest,
  output: Schema.String,
  input: Schema.Struct({ value: Schema.String }),
  checkpoint: Schema.Boolean,
  run: (input, step, checkpoint) => checkpoint === null ? step.save(true) : Effect.succeed({ output: "child:" + input.value }),
});
`;

describe("universal durable sandbox tracer", () => {
	it.live("replays a script without duplicating durable effects", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const http = yield* startFakeHttpServerScoped((url) =>
				url.pathname === "/failure"
					? new Response("try later", { status: 503 })
					: Response.json({ tracer: true }),
			);
			const scriptSlug = `durable-tracer-${yield* randomUuid}`;
			const childSlug = `durable-tracer-child-${yield* randomUuid}`;
			const scriptEntry = "backend/scripts/durable-tracer.sandbox.ts";
			const childEntry = "backend/scripts/durable-tracer-child.sandbox.ts";
			const plugin = yield* Effect.acquireRelease(
				installTestPluginBundle({
					client,
					entitySchemas: [ratedItemEntitySchema],
					pluginSlug: `e2e-durable-tracer-${yield* randomUuid}`,
					workflows: [{ slug: "tracer-child", scriptSlug: childSlug }],
					files: {
						[scriptEntry]: scriptSource({ slug: scriptSlug, name: "Durable tracer" }),
						[childEntry]: childSource({ slug: childSlug, name: "Durable tracer child" }),
					},
					scripts: [
						{
							kind: "script",
							slug: scriptSlug,
							entry: scriptEntry,
							name: "Durable tracer",
							requiredPluginConfigKeys: [],
							capabilities: [
								"log",
								"span",
								"httpCall",
								"getCachedValue",
								"getUserPreferences",
								"executeRyotql",
								"claimPersistentValue",
							],
						},
						{
							slug: childSlug,
							kind: "workflow",
							capabilities: [],
							entry: childEntry,
							name: "Durable tracer child",
							requiredPluginConfigKeys: [],
						},
					],
				}),
				uninstallTestPlugin,
			);
			const fixture = yield* createRatedItem(client, plugin.pluginId);
			const scriptId = requirePresent(
				plugin.scriptIds[scriptSlug],
				"Durable tracer script was not installed",
			);
			const { jobId, executionId } = yield* enqueueSandboxScript(userId, {
				scriptId,
				lane: "interactive",
				context: {
					entityId: fixture.entityId,
					successUrl: `${http.url}/success`,
					failureUrl: `${http.url}/failure`,
				},
			});
			yield* pollUntil(
				"durable tracer journal projection",
				sampleOperationalPressure([executionId]).pipe(
					Effect.map((pressure) =>
						pressure.journal.maxJournalEntries >= 7 ? pressure.journal.maxJournalEntries : null,
					),
				),
			);
			expect((yield* deleteSandboxReplayProjection(executionId)).deleted).toBe(true);
			const value = requireObjectRecord(
				requireCompletedSandboxValue(yield* pollSandboxResult(userId, jobId), "durable tracer"),
				"Durable tracer result must be an object",
			);

			expect(requireArray(value.rows, "Durable tracer rows")).toHaveLength(1);
			expect(value.claim).toEqual({ claimed: true });
			expect(value.child).toBe(`child:${fixture.entityId}`);
			expect(value.parallel).toEqual([null, null]);
			expect(value.preferences).toEqual({ disableIntegrations: false });
			expect(value.http).toMatchObject({ status: 200 });
			expect(value.failure).toMatchObject({
				message: "HTTP 503",
				data: {
					status: 503,
					body: "try later",
					headers: { "content-length": "9", "content-type": "application/octet-stream" },
				},
			});
			expect(value.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
			expect(http.requests.map(({ path }) => path)).toEqual(["/success", "/failure"]);
		}),
	);
});
