import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEventTestFixture,
	deleteSandboxReplayProjection,
	enqueueSandboxScript,
	installTestPluginBundle,
	pollSandboxResult,
	pollUntil,
	requireCompletedSandboxValue,
	sampleOperationalPressure,
	uninstallTestPlugin,
	waitForEventCount,
} from "~/fixtures";
import { requireArray, requireObjectRecord, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { startFakeHttpServerScoped } from "~/support/fake-http-server";

const operationSource = (input: { readonly name: string; readonly slug: string }) => `
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import { defineOperation } from "@ryot/sandbox-sdk/operation";
import { buildEntityReadDocument, ryotqlRows } from "@ryot/sandbox-sdk/ryotql";

export const manifest = defineManifest({
  kind: "operation",
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
  capabilities: [
    "log",
    "span",
    "httpCall",
    "createEvents",
    "getCachedValue",
    "getUserPreferences",
    "executeRyotql",
    "claimPersistentValue",
  ],
});

export default defineOperation({
  manifest,
  output: Schema.Unknown,
  input: Schema.Struct({
    entityId: Schema.String,
    successUrl: Schema.String,
    failureUrl: Schema.String,
    eventSchemaSlug: Schema.String,
    entitySchemaSlug: Schema.String,
  }),
  run: (input, host, execution) => Effect.gen(function* () {
    yield* host.log([{ level: "info", message: "durable tracer started" }]);
    const preferences = yield* host.getUserPreferences();
    const rows = ryotqlRows(yield* host.executeRyotql(buildEntityReadDocument({
      entityIds: [input.entityId],
      entitySchemaSlugs: [input.entitySchemaSlug],
    })), "entities").items;
    const claim = yield* host.claimPersistentValue(
      "durable-tracer-" + input.entityId,
      { executionId: execution.sandboxScriptId },
      3600,
    );
    const events = yield* host.createEvents([{
      entityId: input.entityId,
      eventSchemaSlug: input.eventSchemaSlug,
      properties: { rating: 9 },
    }]);
    const http = yield* host.httpCall("GET", input.successUrl);
    const failure = yield* host.httpCall("GET", input.failureUrl).pipe(
      Effect.catch((error) => Effect.succeed({ message: error.message, data: error.data })),
    );
    const parallel = yield* Effect.all([
      host.getCachedValue("durable-tracer-a"),
      host.getCachedValue("durable-tracer-b"),
    ], { concurrency: "unbounded" });
    if (!host.executeWorkflow) {
      return yield* Effect.fail(new Error("executeWorkflow is unavailable"));
    }
    const child = yield* host.executeWorkflow(
      "tracer-child",
      {
        workflowSlug: "tracer-child",
        input: Schema.Struct({ value: Schema.String }),
        output: Schema.String,
      },
      { value: input.entityId },
    );
    yield* host.span([{ name: "durable.tracer.completed" }]);
    return {
      rows,
      http,
      child,
      claim,
      events,
      failure,
      parallel,
      preferences,
      startedAt: execution.startedAt,
    };
  }),
});
`;

const childSource = (input: { readonly name: string; readonly slug: string }) => `
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot/sandbox-sdk/workflow";

export const manifest = defineManifest({
  kind: "workflow",
  capabilities: [],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
});

export default defineWorkflow({
  manifest,
  output: Schema.String,
  input: Schema.Struct({ value: Schema.String }),
  run: (input, replay) => replay.sleep("tracer-pause", 1500).pipe(
    Effect.as("child:" + input.value),
  ),
});
`;

describe("universal durable sandbox tracer", () => {
	it.live("replays a role-specific operation without duplicating durable effects", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const fixture = yield* createEventTestFixture(client);
			const http = yield* startFakeHttpServerScoped((url) =>
				url.pathname === "/failure"
					? new Response("try later", { status: 503 })
					: Response.json({ tracer: true }),
			);
			const operationSlug = `durable-tracer-${crypto.randomUUID()}`;
			const childSlug = `durable-tracer-child-${crypto.randomUUID()}`;
			const operationEntry = "scripts/durable-tracer.sandbox.ts";
			const childEntry = "scripts/durable-tracer-child.sandbox.ts";
			const plugin = yield* Effect.acquireRelease(
				installTestPluginBundle({
					pluginSlug: `e2e-durable-tracer-${crypto.randomUUID()}`,
					workflows: [{ slug: "tracer-child", scriptSlug: childSlug }],
					files: {
						[operationEntry]: operationSource({ name: "Durable tracer", slug: operationSlug }),
						[childEntry]: childSource({ name: "Durable tracer child", slug: childSlug }),
					},
					operations: [
						{
							auth: "user",
							slug: "durable-tracer",
							scriptSlug: operationSlug,
							description: "Exercises the universal durable host protocol",
						},
					],
					scripts: [
						{
							kind: "operation",
							slug: operationSlug,
							entry: operationEntry,
							name: "Durable tracer",
							requiredPluginConfigKeys: [],
							requiredSystemConfigKeys: [],
							capabilities: [
								"log",
								"span",
								"httpCall",
								"createEvents",
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
							requiredSystemConfigKeys: [],
						},
					],
				}),
				uninstallTestPlugin,
			);
			const scriptId = requirePresent(
				plugin.scriptIds[operationSlug],
				"Durable tracer operation was not installed",
			);
			const { executionId, jobId } = yield* enqueueSandboxScript(userId, {
				scriptId,
				context: {
					entityId: fixture.entityId,
					successUrl: `${http.url}/success`,
					failureUrl: `${http.url}/failure`,
					eventSchemaSlug: fixture.eventSchemaSlug,
					entitySchemaSlug: fixture.entitySchemaSlug,
				},
			});
			yield* pollUntil(
				"durable tracer journal projection",
				sampleOperationalPressure([executionId]).pipe(
					Effect.map((pressure) =>
						pressure.redis.maxHighWater >= 8 ? pressure.redis.maxHighWater : null,
					),
				),
			);
			expect((yield* deleteSandboxReplayProjection(executionId)).deleted).toBe(true);
			const value = requireObjectRecord(
				requireCompletedSandboxValue(yield* pollSandboxResult(userId, jobId), "durable tracer"),
				"Durable tracer output must be an object",
			);

			expect(requireArray(value.rows, "Durable tracer rows")).toHaveLength(1);
			expect(value.claim).toEqual({ claimed: true });
			expect(value.events).toEqual({ count: 1 });
			expect(value.child).toBe(`child:${fixture.entityId}`);
			expect(value.parallel).toEqual([null, null]);
			expect(value.preferences).toEqual({ disableIntegrations: false, isNsfw: false });
			expect(value.http).toMatchObject({ status: 200 });
			expect(value.failure).toMatchObject({
				message: "HTTP 503",
				data: {
					body: "try later",
					status: 503,
					headers: {
						"content-length": "9",
						"content-type": "application/octet-stream",
					},
				},
			});
			expect(value.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
			expect(http.requests.map(({ path }) => path)).toEqual(["/success", "/failure"]);
			expect(yield* waitForEventCount(client, fixture.entityId, 1)).toHaveLength(1);
		}),
	);
});
