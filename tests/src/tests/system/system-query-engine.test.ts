import { EntitySchemaSlug } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	adminHeaders,
	buildEntityRowsQueryDocument,
	createAuthenticatedClient,
	createEntity,
	createQueryEngineEvent,
	createRelationship,
	enqueueSandboxScript,
	executeQueryEngine,
	fakeProviderDetailsResult,
	getBackendClient,
	installTestPluginBundle,
	makeEntitySchemaSlug,
	pollSandboxResult,
	pollUntil,
	propertyRef,
	providerSandboxSource,
	requireCompletedSandboxValue,
	systemRef,
	type Client,
	type InstalledTestPlugin,
	type QueryEnginePayload,
	uninstallTestPlugin,
} from "~/fixtures";
import {
	assertPresent,
	requireArray,
	requireObjectRecord,
	requireString,
} from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";

const suffix = crypto.randomUUID();
const pluginSlug = `e2e-system-query-${suffix}`;
const rootSlug = `e2e-system-query-root-${suffix}`;
const linkSlug = `e2e-system-query-link-${suffix}`;
const targetSlug = `e2e-system-query-target-${suffix}`;
const markerSlug = `e2e-system-query-marker-${suffix}`;
const ownEventSlug = `e2e-system-query-event-${suffix}`;
const detailsSlug = `e2e-system-query-details-${suffix}`;
const workflowSlug = `e2e-system-query-workflow-${suffix}`;
const providerSlug = `e2e-system-query-provider-${suffix}`;
const collectorSlug = `e2e-system-query-collector-${suffix}`;
const foreignPluginSlug = `e2e-system-query-foreign-${suffix}`;
const foreignRootSlug = `e2e-system-query-foreign-root-${suffix}`;
const foreignLinkSlug = `e2e-system-query-foreign-link-${suffix}`;
const foreignEventSlug = `e2e-system-query-foreign-event-${suffix}`;
const workflowScriptSlug = `e2e-system-query-workflow-script-${suffix}`;
const workflowCronSlug = `a-workflow-${suffix}`;
const collectorCronSlug = `z-collector-${suffix}`;

const cases = [
	"system-rows",
	"foreign-root",
	"foreign-relationship",
	"foreign-event",
	"relationship-root",
	"event-root",
	"entity-aggregate",
	"event-time-series",
	"correlated",
	"foreign-aggregate-relationship",
	"foreign-first-event",
] as const;
type CaseName = (typeof cases)[number];

const activitySlug = (name: CaseName) => `e2e-system-query-${name}-${suffix}`;
const cacheKey = (name: CaseName) => `system-query-${name}-${suffix}`;
const fields = [
	{ key: "id", expr: systemRef("root", "id") },
	{ key: "name", expr: systemRef("root", "name") },
];

const systemRowsDocument: QueryEnginePayload = {
	source: { where: null, alias: "root", type: "entities", schemas: [rootSlug] },
	output: {
		fields,
		type: "rows",
		pagination: { page: 1, limit: 20 },
		orderBy: [{ order: "asc", expr: systemRef("root", "name") }],
		include: [
			{
				limit: 20,
				key: "targets",
				fields: [{ key: "name", expr: systemRef("target", "name") }],
				orderBy: [{ order: "asc", expr: systemRef("target", "name") }],
				source: {
					where: null,
					alias: "target",
					type: "entities",
					schemas: [targetSlug],
					via: {
						schema: linkSlug,
						entityRef: "root",
						alias: "rootTarget",
						direction: "outgoing",
					},
				},
			},
		],
	},
};

const foreignRootDocument: QueryEnginePayload = {
	source: { where: null, alias: "root", type: "entities", schemas: [foreignRootSlug] },
	output: {
		fields,
		type: "rows",
		pagination: { page: 1, limit: 10 },
		orderBy: [{ order: "asc", expr: systemRef("root", "name") }],
	},
};

const nestedDocument = (input: { relationshipSlug: string; eventSlug?: string }) =>
	({
		source: { where: null, alias: "root", type: "entities", schemas: [rootSlug] },
		output: {
			fields,
			type: "rows",
			pagination: { page: 1, limit: 10 },
			orderBy: [{ order: "asc", expr: systemRef("root", "name") }],
			include: [
				{
					limit: 10,
					key: "targets",
					orderBy: [{ order: "asc", expr: systemRef("target", "name") }],
					fields: input.eventSlug
						? [
								{
									key: "hasForeignEvent",
									expr: {
										type: "exists",
										source: {
											where: null,
											type: "events",
											entityRef: "target",
											alias: "foreignEvent",
											schemas: [input.eventSlug],
										},
									},
								},
							]
						: [{ key: "name", expr: systemRef("target", "name") }],
					source: {
						where: null,
						alias: "target",
						type: "entities",
						schemas: [targetSlug],
						via: {
							entityRef: "root",
							alias: "rootTarget",
							direction: "outgoing",
							schema: input.relationshipSlug,
						},
					},
				},
			],
		},
	}) as QueryEnginePayload;

const relationshipRootDocument: QueryEnginePayload = {
	source: {
		where: null,
		alias: "link",
		type: "relationships",
		schemas: [linkSlug],
		sourceEntity: { alias: "source", schemas: [rootSlug] },
		targetEntity: { alias: "target", schemas: [targetSlug] },
	},
	output: {
		type: "rows",
		pagination: { page: 1, limit: 20 },
		orderBy: [
			{ order: "asc", expr: systemRef("source", "name") },
			{ order: "asc", expr: propertyRef("link", linkSlug, "rank") },
		],
		fields: [
			{ key: "id", expr: systemRef("link", "id") },
			{ key: "rank", expr: propertyRef("link", linkSlug, "rank") },
			{ key: "sourceId", expr: systemRef("link", "sourceEntityId") },
			{ key: "targetId", expr: systemRef("link", "targetEntityId") },
			{ key: "sourceName", expr: systemRef("source", "name") },
			{ key: "targetName", expr: systemRef("target", "name") },
		],
	},
};

const eventRootDocument: QueryEnginePayload = {
	source: {
		where: null,
		type: "events",
		alias: "activity",
		schemas: [ownEventSlug],
		entity: { alias: "root", schemas: [rootSlug] },
	},
	output: {
		type: "rows",
		pagination: { page: 1, limit: 20 },
		orderBy: [{ order: "asc", expr: systemRef("activity", "occurredAt") }],
		fields: [
			{ key: "userId", expr: systemRef("activity", "userId") },
			{ key: "rootName", expr: systemRef("root", "name") },
			{ key: "occurredAt", expr: systemRef("activity", "occurredAt") },
			{ key: "value", expr: propertyRef("activity", ownEventSlug, "value") },
		],
	},
};

const entityAggregateDocument: QueryEnginePayload = {
	source: { where: null, alias: "root", type: "entities", schemas: [rootSlug] },
	output: {
		type: "aggregate",
		measures: [
			{ key: "count", aggregation: { function: "count" } },
			{
				key: "totalScore",
				aggregation: { function: "sum", expr: propertyRef("root", rootSlug, "score") },
			},
		],
	},
};

const eventTimeSeriesDocument: QueryEnginePayload = {
	source: {
		where: null,
		type: "events",
		alias: "activity",
		schemas: [ownEventSlug],
		entity: { alias: "root", schemas: [rootSlug] },
	},
	output: {
		type: "timeSeries",
		measure: {
			aggregation: {
				function: "sum",
				expr: propertyRef("activity", ownEventSlug, "value"),
			},
		},
		time: {
			bucket: "day",
			expr: systemRef("activity", "occurredAt"),
			range: { startAt: "2026-01-01T00:00:00.000Z", endAt: "2026-01-03T00:00:00.000Z" },
		},
	},
};

const correlatedDocument = (input: {
	eventSlug: string;
	relationshipSlug: string;
}): QueryEnginePayload => ({
	source: { where: null, alias: "root", type: "entities", schemas: [rootSlug] },
	output: {
		type: "rows",
		pagination: { page: 1, limit: 20 },
		orderBy: [{ order: "asc", expr: systemRef("root", "name") }],
		fields: [
			{ key: "name", expr: systemRef("root", "name") },
			{
				key: "targetCount",
				expr: {
					type: "aggregate",
					aggregation: { function: "count" },
					source: {
						where: null,
						alias: "targetCountEntity",
						type: "entities",
						schemas: [targetSlug],
						via: {
							entityRef: "root",
							direction: "outgoing",
							alias: "targetCountLink",
							schema: input.relationshipSlug,
						},
					},
				},
			},
			{
				key: "firstTarget",
				expr: {
					type: "first",
					select: systemRef("firstTargetEntity", "name"),
					orderBy: [
						{
							order: "asc",
							expr: propertyRef("firstTargetLink", input.relationshipSlug, "rank"),
						},
					],
					source: {
						where: null,
						alias: "firstTargetEntity",
						type: "entities",
						schemas: [targetSlug],
						via: {
							entityRef: "root",
							direction: "outgoing",
							alias: "firstTargetLink",
							schema: input.relationshipSlug,
						},
					},
				},
			},
			{
				key: "eventTotal",
				expr: {
					type: "aggregate",
					aggregation: {
						function: "sum",
						expr: propertyRef("aggregateEvent", input.eventSlug, "value"),
					},
					source: {
						where: null,
						type: "events",
						entityRef: "root",
						alias: "aggregateEvent",
						schemas: [input.eventSlug],
					},
				},
			},
			{
				key: "latestEventValue",
				expr: {
					type: "first",
					select: propertyRef("firstEvent", input.eventSlug, "value"),
					orderBy: [{ order: "desc", expr: systemRef("firstEvent", "occurredAt") }],
					source: {
						where: null,
						type: "events",
						entityRef: "root",
						alias: "firstEvent",
						schemas: [input.eventSlug],
					},
				},
			},
		],
	},
});

const correlatedPathDocument = (
	input: Parameters<typeof correlatedDocument>[0],
	key: "targetCount" | "latestEventValue",
) => {
	const document = correlatedDocument(input);
	if (document.output.type !== "rows") {
		throw new Error("Expected correlated rows document");
	}
	return {
		...document,
		output: {
			...document.output,
			fields: document.output.fields.filter((field) => field.key === key),
		},
	} as QueryEnginePayload;
};

const documents: Record<CaseName, QueryEnginePayload> = {
	"system-rows": systemRowsDocument,
	"foreign-root": foreignRootDocument,
	"foreign-event": nestedDocument({ relationshipSlug: linkSlug, eventSlug: foreignEventSlug }),
	"foreign-relationship": nestedDocument({ relationshipSlug: foreignLinkSlug }),
	"relationship-root": relationshipRootDocument,
	"event-root": eventRootDocument,
	"entity-aggregate": entityAggregateDocument,
	"event-time-series": eventTimeSeriesDocument,
	correlated: correlatedDocument({ relationshipSlug: linkSlug, eventSlug: ownEventSlug }),
	"foreign-aggregate-relationship": correlatedPathDocument(
		{
			eventSlug: ownEventSlug,
			relationshipSlug: foreignLinkSlug,
		},
		"targetCount",
	),
	"foreign-first-event": correlatedPathDocument(
		{
			eventSlug: foreignEventSlug,
			relationshipSlug: linkSlug,
		},
		"latestEventValue",
	),
};

const activitySource = (name: CaseName) => `
import { defineActivity } from "@ryot/sandbox-sdk/activity";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import { jsonValueSchema } from "@ryot/sandbox-sdk/wire";

export const manifest = defineManifest({
  kind: "activity",
  name: ${JSON.stringify(`System query ${name}`)},
  slug: ${JSON.stringify(activitySlug(name))},
  capabilities: ["executeQueryEngine", "setCachedValue"],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
});

const query = Schema.decodeUnknownSync(jsonValueSchema)(JSON.parse(${JSON.stringify(
	JSON.stringify(documents[name]),
)}));

export default defineActivity({
  manifest,
  input: Schema.Unknown,
  output: Schema.Unknown,
  run: (_input, host) => host.executeQueryEngine(query).pipe(
    Effect.flatMap(Schema.decodeUnknown(jsonValueSchema)),
    Effect.map((value) => ({ ok: true, value, error: null })),
    Effect.catchAll((error) => Effect.succeed({
      ok: false,
      value: null,
      error: typeof error === "object" && error !== null && "message" in error
        ? String(error.message)
        : String(error),
    })),
    Effect.tap((result) => host.setCachedValue(${JSON.stringify(cacheKey(name))}, result, 300)),
  ),
});
`;

const workflowSource = `
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot/sandbox-sdk/workflow";

export const manifest = defineManifest({
  kind: "workflow",
  name: "System query workflow",
  slug: ${JSON.stringify(workflowScriptSlug)},
  capabilities: [],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
});

const activity = (scriptSlug: string) => ({ input: Schema.Unknown, output: Schema.Unknown, scriptSlug });

export default defineWorkflow({
  manifest,
  input: Schema.Unknown,
  output: Schema.Unknown,
  run: (_input, replay) => Effect.gen(function* () {
    const results = [];
${cases
	.map(
		(name) =>
			`    results.push(yield* replay.activity(${JSON.stringify(name)}, activity(${JSON.stringify(activitySlug(name))}), {}));`,
	)
	.join("\n")}
    return results;
  }),
});
`;

const collectorSource = `
import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  name: "System query result collector",
  slug: ${JSON.stringify(collectorSlug)},
  capabilities: ["executeQueryEngine", "getCachedValue", "upsertGlobalEntities"],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
});

export default defineScript({
  manifest,
  input: Schema.Unknown,
  output: Schema.Struct({ count: Schema.Number, queryEngineAvailable: Schema.Boolean }),
  run: (_input, host) => Effect.gen(function* () {
    const queryEngineAvailable = typeof host.executeQueryEngine === "function";
	const kindGate = queryEngineAvailable
	  ? { ok: true, error: null, queryEngineAvailable }
	  : { ok: false, error: "executeQueryEngine is unavailable to direct system cron scripts", queryEngineAvailable };
    const items = [];
${cases
	.map(
		(name) =>
			`    items.push({ name: ${JSON.stringify(name)}, payload: yield* host.getCachedValue(${JSON.stringify(cacheKey(name))}) });`,
	)
	.join("\n")}
    items.push({ name: "kind-gate", payload: kindGate });
    const entities = yield* host.upsertGlobalEntities(items.map((item) => ({
      name: item.name,
      populatedAt: null,
      properties: { payload: item.payload },
      entitySchemaSlug: ${JSON.stringify(markerSlug)},
      externalId: ${JSON.stringify(`e2e-system-query-result-${suffix}-`)} + item.name,
    })));
    return { queryEngineAvailable, count: entities.length };
  }),
});
`;

const foreignSource = `
import { defineActivity } from "@ryot/sandbox-sdk/activity";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "activity",
  name: "Foreign inert activity",
  slug: ${JSON.stringify(`foreign-inert-${suffix}`)},
  capabilities: [],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
});

export default defineActivity({
  manifest,
  input: Schema.Unknown,
  output: Schema.Null,
  run: () => Effect.succeed(null),
});
`;

const markerDocument = buildEntityRowsQueryDocument({
	alias: "marker",
	limit: 20,
	schemas: [markerSlug],
	fields: [
		{ key: "name", expr: systemRef("marker", "name") },
		{ key: "properties", expr: systemRef("marker", "properties") },
		{ key: "externalId", expr: systemRef("marker", "externalId") },
	],
});

let userA: { client: Client; userId: string };
let userB: { client: Client; userId: string };
let installed: InstalledTestPlugin | undefined;
let foreignInstalled: InstalledTestPlugin | undefined;
let markerRows: ReadonlyArray<Record<string, unknown>> = [];
let expectedRelationships: ReadonlyArray<{
	id: string;
	rank: number;
	sourceId: string;
	targetId: string;
	sourceName: string;
	targetName: string;
}> = [];

const rowField = (row: Record<string, unknown>, key: string) => {
	const field = requireObjectRecord(row[key], `Expected '${key}' field`);
	return field["value"];
};

const markerPayload = (name: CaseName | "kind-gate") => {
	const row = markerRows.find((candidate) => rowField(candidate, "name") === name);
	assertPresent(row, `Expected marker row '${name}'`);
	const properties = requireObjectRecord(rowField(row, "properties"), "Expected marker properties");
	return properties["payload"];
};

const responseData = (payload: unknown) => {
	const result = requireObjectRecord(payload, "Expected activity result object");
	expect(result["ok"]).toBe(true);
	const value = requireObjectRecord(result["value"], "Expected query response object");
	return requireObjectRecord(value["data"], "Expected query response data");
};

const responseItems = (payload: unknown) => {
	const data = responseData(payload);
	return requireArray(data["items"], "Expected query response items").map((item) =>
		requireObjectRecord(item, "Expected query response row"),
	);
};

describe("system-authority query engine", () => {
	beforeAll(async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				userA = yield* createAuthenticatedClient();
				userB = yield* createAuthenticatedClient();

				const detailsEntry = "scripts/details.sandbox.ts";
				const workflowEntry = "scripts/workflow.sandbox.ts";
				const collectorEntry = "scripts/collector.sandbox.ts";
				const activityEntries: Record<CaseName, string> = {
					correlated: "scripts/correlated.sandbox.ts",
					"event-root": "scripts/event-root.sandbox.ts",
					"foreign-root": "scripts/foreign-root.sandbox.ts",
					"system-rows": "scripts/system-rows.sandbox.ts",
					"entity-aggregate": "scripts/entity-aggregate.sandbox.ts",
					"foreign-event": "scripts/foreign-event.sandbox.ts",
					"relationship-root": "scripts/relationship-root.sandbox.ts",
					"event-time-series": "scripts/event-time-series.sandbox.ts",
					"foreign-first-event": "scripts/foreign-first-event.sandbox.ts",
					"foreign-relationship": "scripts/foreign-relationship.sandbox.ts",
					"foreign-aggregate-relationship": "scripts/foreign-aggregate-relationship.sandbox.ts",
				};
				installed = yield* installTestPluginBundle({
					pluginSlug,
					configSchema: { fields: {}, unknownKeys: "strict" },
					linkToEntitySchemaSlug: markerSlug,
					files: {
						[detailsEntry]: providerSandboxSource({
							operation: "details",
							slug: detailsSlug,
							name: "System query provider details",
							result: fakeProviderDetailsResult({ name: "System query provider" }),
						}),
						[workflowEntry]: workflowSource,
						[collectorEntry]: collectorSource,
						...Object.fromEntries(
							cases.map((name) => [activityEntries[name], activitySource(name)]),
						),
					},
					providers: [
						{
							slug: providerSlug,
							name: "System query provider",
							information: { source: "e2e" },
							operations: { details: detailsSlug },
						},
					],
					workflows: [{ slug: workflowSlug, scriptSlug: workflowScriptSlug }],
					crons: [
						{
							workflowSlug,
							lot: "workflow",
							slug: workflowCronSlug,
							schedule: { cron: "0 0 * * *" },
							description: "Run system query activities",
						},
						{
							lot: "script",
							slug: collectorCronSlug,
							scriptSlug: collectorSlug,
							schedule: { cron: "0 0 * * *" },
							description: "Collect system query activity results",
						},
					],
					scripts: [
						{
							providerSlug,
							kind: "provider",
							capabilities: [],
							slug: detailsSlug,
							entry: detailsEntry,
							requiredPluginConfigKeys: [],
							requiredSystemConfigKeys: [],
							providerOperation: "details",
							name: "System query provider details",
						},
						{
							kind: "workflow",
							capabilities: [],
							entry: workflowEntry,
							slug: workflowScriptSlug,
							requiredPluginConfigKeys: [],
							requiredSystemConfigKeys: [],
							name: "System query workflow",
						},
						...cases.map((name) => ({
							providerSlug,
							slug: activitySlug(name),
							kind: "activity" as const,
							requiredPluginConfigKeys: [],
							requiredSystemConfigKeys: [],
							name: `System query ${name}`,
							entry: activityEntries[name],
							capabilities: ["executeQueryEngine", "setCachedValue"],
						})),
						{
							providerSlug,
							kind: "script",
							slug: collectorSlug,
							entry: collectorEntry,
							requiredPluginConfigKeys: [],
							requiredSystemConfigKeys: [],
							name: "System query result collector",
							capabilities: ["executeQueryEngine", "getCachedValue", "upsertGlobalEntities"],
						},
					],
					entitySchemas: [
						{
							icon: "box",
							slug: rootSlug,
							accentColor: "#334155",
							name: "System query root",
							propertiesSchema: {
								fields: {
									score: { type: "integer", label: "Score", description: "Aggregate score" },
								},
							},
							eventSchemas: [
								{
									name: "Own event",
									slug: ownEventSlug,
									propertiesSchema: {
										fields: {
											value: { label: "Value", type: "integer", description: "Event value" },
										},
									},
								},
							],
						},
						{
							icon: "circle",
							slug: targetSlug,
							eventSchemas: [],
							accentColor: "#475569",
							name: "System query target",
							propertiesSchema: {
								fields: { rank: { type: "integer", label: "Rank", description: "Target rank" } },
							},
						},
						{
							slug: markerSlug,
							icon: "database",
							eventSchemas: [],
							accentColor: "#64748b",
							name: "System query marker",
							propertiesSchema: { fields: {}, unknownKeys: "passthrough" },
						},
					],
					relationshipSchemas: [
						{
							slug: linkSlug,
							name: "System query link",
							propertiesSchema: { fields: {} },
							sourceEntitySchemaSlug: rootSlug,
							targetEntitySchemaSlug: targetSlug,
						},
					],
				});

				foreignInstalled = yield* installTestPluginBundle({
					pluginSlug: foreignPluginSlug,
					configSchema: { fields: {}, unknownKeys: "strict" },
					files: { "scripts/foreign.sandbox.ts": foreignSource },
					scripts: [
						{
							kind: "activity",
							capabilities: [],
							requiredPluginConfigKeys: [],
							requiredSystemConfigKeys: [],
							name: "Foreign inert activity",
							slug: `foreign-inert-${suffix}`,
							entry: "scripts/foreign.sandbox.ts",
						},
					],
					entitySchemas: [
						{
							icon: "ban",
							name: "Foreign root",
							slug: foreignRootSlug,
							accentColor: "#991b1b",
							propertiesSchema: { fields: {} },
							eventSchemas: [
								{
									name: "Foreign event",
									slug: foreignEventSlug,
									propertiesSchema: { fields: {} },
								},
							],
						},
					],
					relationshipSchemas: [
						{
							name: "Foreign link",
							slug: foreignLinkSlug,
							propertiesSchema: { fields: {} },
							sourceEntitySchemaSlug: rootSlug,
							targetEntitySchemaSlug: targetSlug,
						},
					],
				});

				const backend = getBackendClient();
				const createGlobal = (name: string, schema: string, externalId: string) =>
					backend.call(
						(c) =>
							c.testSupport.createGlobalEntity({
								payload: {
									name,
									externalId,
									properties: {},
									entitySchemaSlug: EntitySchemaSlug.make(schema),
								},
							}),
						adminHeaders,
					);
				const globalRoot = yield* backend.call(
					(c) =>
						c.testSupport.createGlobalEntity({
							payload: {
								name: "Global Root",
								properties: { score: 10 },
								externalId: `global-root-${suffix}`,
								entitySchemaSlug: EntitySchemaSlug.make(rootSlug),
							},
						}),
					adminHeaders,
				);
				const targetA = yield* createGlobal("Target A", targetSlug, `target-a-${suffix}`);
				const targetB = yield* createGlobal("Target B", targetSlug, `target-b-${suffix}`);
				const userARoot = yield* createEntity(userA.client, {
					properties: { score: 100 },
					name: "User A Root",
					entitySchemaSlug: makeEntitySchemaSlug(rootSlug),
				});
				const userBRoot = yield* createEntity(userB.client, {
					properties: { score: 200 },
					name: "User B Root",
					entitySchemaSlug: makeEntitySchemaSlug(rootSlug),
				});
				const relationships = yield* Effect.all([
					createRelationship(userA.client, {
						properties: { rank: 2 },
						targetEntityId: targetA.id,
						sourceEntityId: globalRoot.id,
						relationshipSchemaSlug: linkSlug,
					}),
					createRelationship(userA.client, {
						properties: { rank: 90 },
						targetEntityId: targetA.id,
						sourceEntityId: userARoot.id,
						relationshipSchemaSlug: linkSlug,
					}),
					createRelationship(userB.client, {
						properties: { rank: 1 },
						targetEntityId: targetB.id,
						sourceEntityId: globalRoot.id,
						relationshipSchemaSlug: linkSlug,
					}),
					createRelationship(userB.client, {
						properties: { rank: 80 },
						targetEntityId: targetB.id,
						sourceEntityId: userBRoot.id,
						relationshipSchemaSlug: linkSlug,
					}),
				]);
				expectedRelationships = [
					{
						rank: 2,
						targetId: targetA.id,
						targetName: "Target A",
						id: relationships[0].id,
						sourceId: globalRoot.id,
						sourceName: "Global Root",
					},
					{
						rank: 1,
						targetId: targetB.id,
						targetName: "Target B",
						id: relationships[2].id,
						sourceId: globalRoot.id,
						sourceName: "Global Root",
					},
					{
						rank: 90,
						targetId: targetA.id,
						targetName: "Target A",
						sourceId: userARoot.id,
						id: relationships[1].id,
						sourceName: "User A Root",
					},
					{
						rank: 80,
						targetId: targetB.id,
						targetName: "Target B",
						sourceId: userBRoot.id,
						id: relationships[3].id,
						sourceName: "User B Root",
					},
				].sort(
					(left, right) =>
						left.sourceName.localeCompare(right.sourceName) || left.rank - right.rank,
				);
				yield* Effect.all([
					createQueryEngineEvent(userA.client, {
						entityId: globalRoot.id,
						properties: { value: 2 },
						eventSchemaSlug: ownEventSlug,
						occurredAt: "2026-01-01T12:00:00.000Z",
					}),
					createQueryEngineEvent(userB.client, {
						entityId: globalRoot.id,
						properties: { value: 3 },
						eventSchemaSlug: ownEventSlug,
						occurredAt: "2026-01-02T12:00:00.000Z",
					}),
				]);

				for (const cronSlug of [workflowCronSlug, collectorCronSlug]) {
					yield* backend.call(
						(c) => c.testSupport.triggerPluginCron({ payload: { cronSlug, pluginSlug } }),
						adminHeaders,
					);
				}
				markerRows = yield* pollUntil(
					"system query result markers",
					Effect.gen(function* () {
						const result = yield* executeQueryEngine(userA.client, markerDocument);
						const rows = result.data.items.filter((row) => {
							const externalId = rowField(row, "externalId");
							return typeof externalId === "string" && externalId.includes(suffix);
						});
						return rows.length === cases.length + 1 ? rows : null;
					}),
					{ timeoutMs: 120_000 },
				);
			}),
		);
	}, 180_000);

	afterAll(async () => {
		if (foreignInstalled) {
			await Effect.runPromise(uninstallTestPlugin(foreignInstalled));
		}
	});

	it.live(
		"runs a pinned workflow activity with system visibility across users and global roots only",
		() =>
			Effect.sync(() => {
				const rows = responseItems(markerPayload("system-rows"));
				expect(rows.map((row) => rowField(row, "name"))).toEqual(["Global Root"]);
				const targets = requireObjectRecord(rows[0]?.["targets"], "Expected targets include");
				const targetRows = requireArray(targets["items"], "Expected target include rows").map(
					(row) => requireObjectRecord(row, "Expected target row"),
				);
				expect(targetRows.map((row) => rowField(row, "name"))).toEqual(["Target A", "Target B"]);
			}),
	);

	it.live("returns caller-owned relationship roots across users with endpoint fields", () =>
		Effect.gen(function* () {
			const systemRows = responseItems(markerPayload("relationship-root"));
			const userRows = (yield* executeQueryEngine(userA.client, relationshipRootDocument)).data
				.items;
			const values = (row: Record<string, unknown>) => ({
				id: rowField(row, "id"),
				rank: rowField(row, "rank"),
				sourceId: rowField(row, "sourceId"),
				targetId: rowField(row, "targetId"),
				sourceName: rowField(row, "sourceName"),
				targetName: rowField(row, "targetName"),
			});

			expect(systemRows.map(values)).toEqual(expectedRelationships);
			expect(userRows.map(values)).toEqual(
				expectedRelationships.filter(
					(row) =>
						(row.sourceName === "Global Root" && row.targetName === "Target A") ||
						row.sourceName === "User A Root",
				),
			);
		}),
	);

	it.live("returns caller-owned event roots across users while preserving user isolation", () =>
		Effect.gen(function* () {
			const systemRows = responseItems(markerPayload("event-root"));
			const userRows = (yield* executeQueryEngine(userA.client, eventRootDocument)).data.items;
			const values = (row: Record<string, unknown>) => ({
				value: rowField(row, "value"),
				userId: rowField(row, "userId"),
				rootName: rowField(row, "rootName"),
				occurredAt: rowField(row, "occurredAt"),
			});
			const expected = [
				{
					value: 2,
					userId: userA.userId,
					rootName: "Global Root",
					occurredAt: "2026-01-01T12:00:00+00:00",
				},
				{
					value: 3,
					userId: userB.userId,
					rootName: "Global Root",
					occurredAt: "2026-01-02T12:00:00+00:00",
				},
			];

			expect(systemRows.map(values)).toEqual(expected);
			expect(userRows.map(values)).toEqual([expected[0]]);
		}),
	);

	it.live("executes exact aggregate and time-series values in system scope", () =>
		Effect.sync(() => {
			const aggregateRows = responseItems(markerPayload("entity-aggregate"));
			expect(aggregateRows).toHaveLength(1);
			expect(
				aggregateRows.map((row) => ({
					count: rowField(row, "count"),
					totalScore: rowField(row, "totalScore"),
				})),
			).toEqual([{ count: 1, totalScore: 10 }]);

			const timeSeriesData = responseData(markerPayload("event-time-series"));
			const buckets = requireArray(timeSeriesData["buckets"], "Expected time-series buckets");
			expect(
				buckets.map((bucket) => requireObjectRecord(bucket, "Expected bucket")["value"]),
			).toEqual([2, 3]);
		}),
	);

	it.live("computes correlated aggregate and first values through owned sources", () =>
		Effect.sync(() => {
			const rows = responseItems(markerPayload("correlated"));
			expect(rows).toHaveLength(1);
			expect(
				rows.map((row) => ({
					name: rowField(row, "name"),
					eventTotal: rowField(row, "eventTotal"),
					targetCount: rowField(row, "targetCount"),
					firstTarget: rowField(row, "firstTarget"),
					latestEventValue: rowField(row, "latestEventValue"),
				})),
			).toEqual([
				{
					eventTotal: 5,
					targetCount: 2,
					name: "Global Root",
					latestEventValue: 3,
					firstTarget: "Target B",
				},
			]);
		}),
	);

	it.live("rejects foreign schemas in correlated aggregate and first paths", () =>
		Effect.sync(() => {
			const expected: ReadonlyArray<[CaseName, string]> = [
				["foreign-aggregate-relationship", `Relationship schema '${foreignLinkSlug}' not found`],
				["foreign-first-event", `Event schema '${foreignEventSlug}' not found`],
			];
			for (const [name, message] of expected) {
				const result = requireObjectRecord(markerPayload(name), `Expected '${name}' failure`);
				expect(result["ok"]).toBe(false);
				expect(requireString(result["error"], `Expected '${name}' error`)).toContain(message);
			}
		}),
	);

	it.live("rejects foreign root, nested relationship, and nested event schema references", () =>
		Effect.sync(() => {
			const expected: ReadonlyArray<[CaseName, string]> = [
				["foreign-root", `Entity schema '${foreignRootSlug}' not found`],
				["foreign-relationship", `Relationship schema '${foreignLinkSlug}' not found`],
				["foreign-event", `Event schema '${foreignEventSlug}' not found`],
			];
			for (const [name, message] of expected) {
				const result = requireObjectRecord(markerPayload(name), `Expected '${name}' failure`);
				expect(result["ok"]).toBe(false);
				expect(requireString(result["error"], `Expected '${name}' error`)).toContain(message);
			}
		}),
	);

	it.live("withholds executeQueryEngine from a direct system cron script", () =>
		Effect.sync(() => {
			const payload = requireObjectRecord(markerPayload("kind-gate"), "Expected kind gate payload");
			expect(payload).toEqual({
				ok: false,
				queryEngineAvailable: false,
				error: "executeQueryEngine is unavailable to direct system cron scripts",
			});
		}),
	);

	it.live("preserves user authority scoping in sandbox and API execution", () =>
		Effect.gen(function* () {
			const scriptId = installed?.scriptIds[activitySlug("system-rows")];
			assertPresent(scriptId, "Expected installed system rows activity");
			const { jobId } = yield* enqueueSandboxScript(userA.userId, { scriptId });
			const sandboxPayload = requireCompletedSandboxValue(
				yield* pollSandboxResult(userA.userId, jobId),
			);
			const sandboxRows = responseItems(sandboxPayload);
			const apiRows = (yield* executeQueryEngine(userA.client, systemRowsDocument)).data.items;

			for (const rows of [sandboxRows, apiRows]) {
				expect(rows.map((row) => rowField(row, "name"))).toEqual(["Global Root", "User A Root"]);
				const global = rows.find((row) => rowField(row, "name") === "Global Root");
				assertPresent(global, "Expected global root row");
				const targets = requireObjectRecord(global["targets"], "Expected global targets include");
				const targetRows = requireArray(targets["items"], "Expected global target rows").map(
					(row) => requireObjectRecord(row, "Expected global target row"),
				);
				expect(targetRows.map((row) => rowField(row, "name"))).toEqual(["Target A"]);
			}
		}),
	);
});
