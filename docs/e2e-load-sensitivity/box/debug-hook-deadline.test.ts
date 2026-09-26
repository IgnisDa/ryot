import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { AutomationHookSlug, EntitySchemaSlug, EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEntity,
	installTestPluginBundle,
	listAutomationRunAttempts,
	listAutomationRuns,
	type InstalledTestPlugin,
	uninstallTestPlugin,
} from "~/fixtures/kernel";
import { afterAll, beforeAll, describe, it, runPromise } from "~/support/effect-test";

const SLEEP_MS = Number(process.env.DEBUG_SLEEP_MS ?? 20000);
const CONCURRENT = Number(process.env.DEBUG_CONCURRENT ?? 6);
const OBSERVE_MS = Number(process.env.DEBUG_OBSERVE_MS ?? 480000);

const suffix = crypto.randomUUID().slice(0, 8);
const slugs = {
	plugin: `e2e-debug-deadline-${suffix}`,
	entity: `debug-entity-${suffix}`,
	event: `debug-event-${suffix}`,
	script: `debug-slow-${suffix}`,
	hook: `debug-required-${suffix}`,
};
const entry = "backend/automations/debug-slow.sandbox.ts";
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
							eventSchemas: [{ slug: slugs.event, name: "Debug event", propertiesSchema: markerSchema }],
						},
					],
					files: { [entry]: source },
					hooks: [
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
				yield* Effect.forEach(
					entities,
					(entity, i) =>
						Effect.gen(function* () {
							const started = Date.now();
							const result = yield* client
								.call((c) =>
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
								)
								.pipe(Effect.result);
							log(`request ${i} done in ${Date.now() - started}ms: ${JSON.stringify(result).slice(0, 400)}`);
						}),
					{ concurrency: "unbounded" },
				);
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
			}),
		OBSERVE_MS + 300000,
	);
});
