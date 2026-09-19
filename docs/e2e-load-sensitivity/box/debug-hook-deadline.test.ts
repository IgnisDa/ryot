import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { AutomationHookSlug, EntitySchemaSlug, EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEntity,
	installTestPluginBundle,
	listAutomationRunAttempts,
	listAutomationRuns,
	listEventsForEntity,
	pollUntil,
	waitForCreateEvents,
	type InstalledTestPlugin,
	uninstallTestPlugin,
} from "~/fixtures/kernel";
import { afterAll, beforeAll, describe, expect, it, runPromise } from "~/support/effect-test";

const SLEEP_MS = Number(process.env.DEBUG_SLEEP_MS ?? 20000);
const CONCURRENT = Number(process.env.DEBUG_CONCURRENT ?? 6);
const OBSERVE_MS = Number(process.env.DEBUG_OBSERVE_MS ?? 480000);

const suffix = crypto.randomUUID().slice(0, 8);
const slugs = {
	plugin: `e2e-debug-deadline-${suffix}`,
	entity: `debug-entity-${suffix}`,
	event: `debug-event-${suffix}`,
	policyEvent: `debug-policy-event-${suffix}`,
	policyScript: `debug-policy-script-${suffix}`,
	policyHook: `debug-policy-hook-${suffix}`,
	script: `debug-slow-${suffix}`,
	hook: `debug-required-${suffix}`,
};
const entry = "backend/automations/debug-slow.sandbox.ts";
const policyEntry = "backend/automations/debug-policy.sandbox.ts";
const projection = {
	event: { properties: [], compareProperties: [] },
	entity: { properties: [], compareProperties: [], parentEntityProperties: [] },
	relationship: { properties: [], compareProperties: [], parentEntityProperties: [] },
};
const source = `
import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
export const manifest = defineManifest({
  kind: "automation", automationType: "automation", slug: ${JSON.stringify(slugs.script)},
  name: "debug slow", capabilities: [], requiredPluginConfigKeys: [], requiredSystemConfigKeys: [],
  inputProjection: ${JSON.stringify(projection)},
});
export default defineAutomation({ manifest, run: () => Effect.sleep(${SLEEP_MS}).pipe(Effect.as(null)) });
`;
const policySource = `
import { defineAutomationPolicy } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
export const manifest = defineManifest({
  kind: "automation", automationType: "policy", slug: ${JSON.stringify(slugs.policyScript)},
  name: "debug policy", capabilities: [], requiredPluginConfigKeys: [], requiredSystemConfigKeys: [],
  inputProjection: { event: { properties: ["marker"] } },
});
export default defineAutomationPolicy({ manifest, run: () => Effect.sleep(${SLEEP_MS}).pipe(Effect.as({ action: "allow" })) });
`;
const markerSchema = {
	unknownKeys: "strict" as const,
	fields: { marker: { label: "Marker", type: "string" as const, description: "m", validation: { required: true as const } } },
};
const scripts = [
	{
		slug: slugs.script,
		name: "debug slow",
		entry,
		kind: "automation",
		automationType: "automation",
		inputProjection: projection,
		capabilities: [],
		requiredPluginConfigKeys: [],
		requiredSystemConfigKeys: [],
	},
	{
		slug: slugs.policyScript,
		name: "debug policy",
		entry: policyEntry,
		kind: "automation",
		automationType: "policy",
		inputProjection: { event: { properties: ["marker"] } },
		capabilities: [],
		requiredPluginConfigKeys: [],
		requiredSystemConfigKeys: [],
	},
] satisfies PluginManifest["scripts"];

let installed: InstalledTestPlugin | undefined;
const t0 = Date.now();
const log = (message: string) => console.log(`DEBUG-EXP +${((Date.now() - t0) / 1000).toFixed(1)}s ${new Date().toISOString()} ${message}`);

describe("debug hook deadline", () => {
	beforeAll(() =>
		runPromise(
			Effect.gen(function* () {
				installed = yield* installTestPluginBundle({
					scripts,
					scope: "system",
					pluginSlug: slugs.plugin,
					entitySchemas: [
						{
							icon: "box",
							slug: slugs.entity,
							name: "Debug entity",
							propertiesSchema: markerSchema,
							eventSchemas: [
								{ slug: slugs.event, name: "Debug event", propertiesSchema: markerSchema },
								{ slug: slugs.policyEvent, name: "Debug policy event", propertiesSchema: markerSchema },
							],
						},
					],
					files: { [entry]: source, [policyEntry]: policySource },
					hooks: [
						{
							stage: "before",
							position: 10,
							slug: slugs.policyHook,
							scriptSlug: slugs.policyScript,
							name: "debug policy",
							targets: [{ resource: "event", operation: "create", entitySchemaSlug: slugs.entity, eventSchemaSlug: slugs.policyEvent }],
						},
						{
							stage: "after",
							delivery: "required",
							slug: slugs.hook,
							scriptSlug: slugs.script,
							name: "debug required",
							targets: [{ resource: "event", operation: "create", entitySchemaSlug: slugs.entity, eventSchemaSlug: slugs.event }],
						},
					],
				});
				log("installed");
			}),
		),
	);
	afterAll(() => runPromise(installed ? uninstallTestPlugin(installed) : Effect.void));

	it.live(
		"observes required hooks past the deadline",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const entities = yield* Effect.forEach(Array.from({ length: CONCURRENT }, (_, i) => i), (i) =>
					createEntity(client, {
						properties: { marker: `m${i}` },
						name: `Debug ${i}`,
						entitySchemaSlug: EntitySchemaSlug.make(slugs.entity),
					}),
				);
				log(`sending ${CONCURRENT} concurrent event requests, sleep=${SLEEP_MS}`);
				const responses = yield* Effect.forEach(
					entities,
					(entity, i) =>
						Effect.gen(function* () {
							const started = Date.now();
							const result = yield* client.call((c) =>
									c.events.create({
										payload: [
											{
												entityId: entity.id,
												occurredAt: new Date().toISOString(),
												properties: { marker: `m${i}` },
												eventSchemaSlug: EventSchemaSlug.make(slugs.event),
											},
										],
									}),
								);
							log(`request ${i} done in ${Date.now() - started}ms: ${JSON.stringify(result).slice(0, 400)}`);
							expect(Date.now() - started).toBeLessThan(45_000);
							return result;
						}),
					{ concurrency: "unbounded" },
				);
				expect(responses.some((response) => "status" in response)).toBe(true);
				const pending = responses.find((response) => "status" in response);
				if (pending && "status" in pending) {
					expect(pending).toMatchObject({ status: "committed-follow-up-pending", writtenCount: 1, writesPending: false });
					const { client: otherClient } = yield* createAuthenticatedClient();
					const denied = yield* Effect.flip(otherClient.call((c) => c.events.getCreateOperation({ params: { operationId: pending.operationId } })));
					expect(denied._tag).toBe("EventOperationNotFound");
				}
				const deadline = Date.now() + OBSERVE_MS;
				let last = "";
				while (Date.now() < deadline) {
					const runs = yield* listAutomationRuns({ hookSlug: AutomationHookSlug.make(slugs.hook) });
					const summary = JSON.stringify(
						runs.map((run) => ({ id: run.id.slice(-6), status: run.status, next: run.nextAttemptAt })),
					);
					if (summary !== last) {
						log(`runs ${summary}`);
						last = summary;
					}
					if (runs.length === CONCURRENT && runs.every((run) => run.status === "succeeded" || run.status === "failed")) {
						for (const run of runs) {
							const attempts = yield* listAutomationRunAttempts({ runId: run.id });
							log(`attempts ${run.id.slice(-6)} ${JSON.stringify(attempts).slice(0, 600)}`);
						}
						break;
					}
					yield* Effect.sleep("5 seconds");
				}
				log("observation finished");
				for (const response of responses) {
					if (!("status" in response)) continue;
					const operation = yield* pollUntil(`event operation ${response.operationId}`, client.call((c) =>
						c.events.getCreateOperation({ params: { operationId: response.operationId } }),
					).pipe(Effect.map((current) => current.status === "completed" ? current : null)));
					expect(operation.result.count).toBe(1);
				}
			}),
		OBSERVE_MS + 300000,
	);

	it.live("rejects writes when before-policies expire while queued", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const entities = yield* Effect.forEach([0, 1, 2], (index) =>
				createEntity(client, {
					properties: { marker: `policy-${index}` },
					name: `Policy ${index}`,
					entitySchemaSlug: EntitySchemaSlug.make(slugs.entity),
				}),
			);
			const responses = yield* Effect.forEach(
				entities,
				(entity, index) => client.call((c) => c.events.create({ payload: [
					{ entityId: entity.id, eventSchemaSlug: EventSchemaSlug.make(slugs.policyEvent), properties: { marker: `policy-${index}` } },
				] })),
				{ concurrency: "unbounded" },
			);
			const completed = yield* Effect.forEach(responses, (response) => waitForCreateEvents(client, response));
			expect(completed.filter((result) => result.count === 1)).toHaveLength(1);
			expect(completed.filter((result) => result.failure?.reason.code === "policy-execution-failed")).toHaveLength(2);
			const policies = yield* pollUntil("late policy attempts", listAutomationRuns({ hookSlug: AutomationHookSlug.make(slugs.policyHook) }).pipe(
				Effect.map((runs) => runs.length === 3 && runs.every((run) => run.status === "succeeded" || run.status === "failed") ? runs : null),
			));
			expect(policies).toHaveLength(3);
			expect(policies.every((run) => run.status === "succeeded")).toBe(true);
			for (const [index, entity] of entities.entries()) {
				const events = yield* listEventsForEntity(client, entity.id, undefined, 100);
				expect(events.filter((event) => event.eventSchemaSlug === slugs.policyEvent)).toHaveLength(completed[index]?.count ?? 0);
			}
		}),
		300_000,
	);

	it.live("reports committed items and remaining writes for one serial batch", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const entity = yield* createEntity(client, {
				properties: { marker: "batch" },
				name: "Batch",
				entitySchemaSlug: EntitySchemaSlug.make(slugs.entity),
			});
			const response = yield* client.call((c) => c.events.create({ payload: [0, 1, 2].map((index) => ({
				entityId: entity.id,
				eventSchemaSlug: EventSchemaSlug.make(slugs.event),
				properties: { marker: `batch-${index}` },
			})) }));
			expect(response).toMatchObject({ status: "committed-follow-up-pending", writesPending: true });
			if (!("status" in response)) return yield* Effect.die("Expected a pending batch operation");
			expect(response.writtenCount).toBeGreaterThan(0);
			expect(response.writtenCount).toBeLessThan(3);
			const completed = yield* waitForCreateEvents(client, response);
			expect(completed).toMatchObject({ count: 3, failure: null });
		}),
		300_000,
	);
});
