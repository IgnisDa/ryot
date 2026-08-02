import type { ContractPayload } from "@ryot/contract/client";
import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import {
	EntityId,
	EntitySchemaSlug,
	PluginSlug,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot/contract/schema/brands";
import {
	and,
	ascending,
	column,
	count,
	document,
	eq,
	exists,
	field,
	include,
	inArray,
	join,
	literal,
	rows,
	table,
} from "@ryot/ryotql";
import { Effect } from "effect";

import type { RyotQLResponse } from "~/fixtures";
import {
	adminHeaders,
	createAuthenticatedClient,
	createEntity,
	createEventFixture,
	createRelationship,
	executeRyotQL,
	fakeProviderDetailsResult,
	getBackendClient,
	installTestPluginBundle,
	literalSandboxSource,
	pollUntil,
	providerSandboxSource,
	requireRyotQLFieldValue,
	uninstallTestPlugin,
} from "~/fixtures";
import {
	requireArray,
	requireObjectRecord,
	requirePresent,
	requireString,
} from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

type PluginScript = ContractPayload<"plugins", "install">["manifest"]["scripts"][number];
type PluginEntitySchema = ContractPayload<
	"plugins",
	"install"
>["manifest"]["entitySchemas"][number];
type PluginRelationshipSchema = ContractPayload<
	"plugins",
	"install"
>["manifest"]["relationshipSchemas"][number];

type AuthorizationProbe = {
	readonly slug: string;
	readonly name: string;
	readonly cronSlug: string;
	readonly externalId: string;
	readonly query: RyotQLDocument;
};

const authorizationProbeSource = (
	input: AuthorizationProbe & { readonly markerSchemaSlug: string },
) => `
import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { ryotqlDocumentSchema } from "@ryot/sandbox-sdk/core";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import { jsonValueSchema } from "@ryot/sandbox-sdk/wire";

export const manifest = defineManifest({
  kind: "script",
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
  capabilities: ["executeRyotql", "upsertGlobalEntities"],
});

const query = Schema.decodeSync(ryotqlDocumentSchema)(JSON.parse(${JSON.stringify(
	JSON.stringify(input.query),
)}));

const errorMessage = (error: unknown) => typeof error === "object" && error !== null && "message" in error
  ? String(error.message)
  : String(error);

export default defineScript({
  manifest,
  input: Schema.Struct({}),
  output: Schema.Struct({ ok: Schema.Boolean }),
  run: (_input, host) => Effect.gen(function* () {
    const outcome = yield* host.executeRyotql(query).pipe(
      Effect.flatMap((value) => Schema.decodeUnknownEffect(jsonValueSchema)(value)),
      Effect.map((result) => ({ error: null, ok: true as const, result })),
      Effect.catch((error) => Effect.succeed({ error: errorMessage(error), ok: false as const, result: null })),
    );
    yield* host.upsertGlobalEntities([{
      populatedAt: null,
      properties: outcome,
      name: ${JSON.stringify(input.name)},
      externalId: ${JSON.stringify(input.externalId)},
      entitySchemaSlug: ${JSON.stringify(input.markerSchemaSlug)},
    }]);
    return { ok: outcome.ok };
  }),
});
`;

const fieldValue = (row: Record<string, unknown>, key: string) =>
	requireObjectRecord(row[key], `Expected '${key}' field`)["value"];

const responseData = (response: unknown) =>
	requireObjectRecord(
		requireObjectRecord(response, "Expected RyotQL response")["data"],
		"Expected response data",
	);

const responseRows = (response: unknown, queryName: string) => {
	const result = requireObjectRecord(
		responseData(response)[queryName],
		`Expected '${queryName}' result`,
	);
	expect(result["type"]).toBe("rows");
	return requireArray(result["items"], `Expected '${queryName}' rows`).map((row) =>
		requireObjectRecord(row, `Expected '${queryName}' row`),
	);
};

const markerPayload = (response: RyotQLResponse) => {
	const markerResult = response.data.marker;
	if (markerResult?.type !== "rows") {
		throw new Error("Expected marker rows");
	}
	const marker = requirePresent(markerResult.items[0], "Expected authorization probe marker");
	const properties = requireRyotQLFieldValue(marker, "properties");
	if (properties.kind !== "json") {
		throw new Error("Expected authorization probe properties JSON");
	}
	return requireObjectRecord(properties.value, "Expected authorization probe payload");
};

const markerDocument = (externalId: string) => {
	const marker = table("entity", "marker");
	return document({
		marker: rows(marker, {
			limit: 1,
			where: eq(column(marker, "externalId"), literal(externalId)),
			fields: [
				field("id", column(marker, "id")),
				field("properties", column(marker, "properties")),
			],
		}),
	});
};

describe("sandbox RyotQL pinned-plugin authorization", () => {
	it.live("enforces plugin ownership across users, definitions, and nested queries", () =>
		Effect.gen(function* () {
			const suffix = crypto.randomUUID();
			const backend = getBackendClient();
			const userA = yield* createAuthenticatedClient();
			const userB = yield* createAuthenticatedClient();
			const userIds = [userA.userId, userB.userId];
			const globalEntityIds: string[] = [];

			const cleanupData = Effect.gen(function* () {
				for (const userId of userIds) {
					yield* backend
						.call(
							(c) => c.godMode.deleteUser({ params: { userId: UserId.make(userId) } }),
							adminHeaders,
						)
						.pipe(Effect.ignore);
				}
				if (globalEntityIds.length > 0) {
					yield* backend
						.call(
							(c) =>
								c.testSupport.deleteGlobalEntities({
									payload: {
										ids: [...new Set(globalEntityIds)].map((id) => EntityId.make(id)),
									},
								}),
							adminHeaders,
						)
						.pipe(Effect.ignore);
				}
			});

			const foreignPluginSlug = `e2e-ryotql-auth-foreign-${suffix}`;
			const foreignRootSlug = `e2e-ryotql-auth-foreign-root-${suffix}`;
			const foreignTargetSlug = `e2e-ryotql-auth-foreign-target-${suffix}`;
			const foreignEventSlug = `e2e-ryotql-auth-foreign-event-${suffix}`;
			const foreignRelationshipSlug = `e2e-ryotql-auth-foreign-relationship-${suffix}`;
			const foreignScriptSlug = `e2e-ryotql-auth-foreign-script-${suffix}`;
			const foreignEntitySchemas: PluginEntitySchema[] = [
				{
					accentColor: "#991b1b",
					eventSchemas: [
						{
							name: "Foreign event",
							slug: foreignEventSlug,
							propertiesSchema: {
								fields: { value: { description: "Value", label: "Value", type: "integer" } },
							},
						},
					],
					icon: "ban",
					name: "Foreign root",
					slug: foreignRootSlug,
					propertiesSchema: { fields: {} },
				},
				{
					eventSchemas: [],
					icon: "circle-slash",
					name: "Foreign target",
					accentColor: "#7f1d1d",
					slug: foreignTargetSlug,
					propertiesSchema: { fields: {} },
				},
			];
			const foreignRelationshipSchemas: PluginRelationshipSchema[] = [
				{
					name: "Foreign relationship",
					slug: foreignRelationshipSlug,
					sourceEntitySchemaSlug: foreignRootSlug,
					targetEntitySchemaSlug: foreignTargetSlug,
					propertiesSchema: {
						fields: { rank: { description: "Rank", label: "Rank", type: "integer" } },
					},
				},
			];

			yield* Effect.acquireRelease(
				installTestPluginBundle({
					pluginSlug: foreignPluginSlug,
					entitySchemas: foreignEntitySchemas,
					relationshipSchemas: foreignRelationshipSchemas,
					files: {
						"scripts/foreign.sandbox.ts": literalSandboxSource({
							value: true,
							slug: foreignScriptSlug,
							name: "Foreign inert script",
						}),
					},
					scripts: [
						{
							kind: "script",
							capabilities: [],
							slug: foreignScriptSlug,
							name: "Foreign inert script",
							requiredPluginConfigKeys: [],
							requiredSystemConfigKeys: [],
							entry: "scripts/foreign.sandbox.ts",
						},
					],
				}),
				(plugin) => cleanupData.pipe(Effect.andThen(uninstallTestPlugin(plugin)), Effect.ignore),
			);

			const pluginSlug = `e2e-ryotql-auth-owned-${suffix}`;
			const providerSlug = `e2e-ryotql-auth-provider-${suffix}`;
			const providerScriptSlug = `${providerSlug}.details`;
			const providerEntry = "scripts/provider-details.sandbox.ts";
			const rootSlug = `e2e-ryotql-auth-root-${suffix}`;
			const targetSlug = `e2e-ryotql-auth-target-${suffix}`;
			const eventSlug = `e2e-ryotql-auth-event-${suffix}`;
			const relationshipSlug = `e2e-ryotql-auth-relationship-${suffix}`;
			const markerSlug = `e2e-ryotql-auth-marker-${suffix}`;
			const entitySchemas: PluginEntitySchema[] = [
				{
					icon: "box",
					slug: rootSlug,
					name: "Owned root",
					accentColor: "#0f766e",
					propertiesSchema: {
						fields: { score: { description: "Score", label: "Score", type: "integer" } },
					},
					eventSchemas: [
						{
							slug: eventSlug,
							name: "Owned event",
							propertiesSchema: {
								fields: { value: { description: "Value", label: "Value", type: "integer" } },
							},
						},
					],
				},
				{
					icon: "circle",
					slug: targetSlug,
					eventSchemas: [],
					name: "Owned target",
					accentColor: "#115e59",
					propertiesSchema: { fields: {} },
				},
				{
					eventSchemas: [],
					icon: "database",
					slug: markerSlug,
					accentColor: "#334155",
					name: "Authorization marker",
					propertiesSchema: { fields: {}, unknownKeys: "passthrough" },
				},
			];
			const relationshipSchemas: PluginRelationshipSchema[] = [
				{
					slug: relationshipSlug,
					name: "Owned relationship",
					sourceEntitySchemaSlug: rootSlug,
					targetEntitySchemaSlug: targetSlug,
					propertiesSchema: {
						fields: { rank: { description: "Rank", label: "Rank", type: "integer" } },
					},
				},
			];

			const entity = table("entity", "entity");
			const pluginEntityDocument = document({
				entities: rows(entity, {
					fields: [
						field("id", column(entity, "id")),
						field("name", column(entity, "name")),
						field("userId", column(entity, "userId")),
						field("entitySchemaSlug", column(entity, "entitySchemaSlug")),
					],
					limit: 20,
					orderBy: [ascending(column(entity, "id"))],
					where: inArray(column(entity, "entitySchemaSlug"), [
						literal(rootSlug),
						literal(targetSlug),
					]),
				}),
			});
			const foreignEntityDocument = document({
				entities: rows(entity, {
					limit: 20,
					fields: [field("id", column(entity, "id"))],
					where: eq(column(entity, "entitySchemaSlug"), literal(foreignRootSlug)),
				}),
			});

			const event = table("event", "event");
			const eventDocument = document({
				events: rows(event, {
					limit: 20,
					where: eq(column(event, "eventSchemaSlug"), literal(eventSlug)),
					orderBy: [ascending(column(event, "userId")), ascending(column(event, "id"))],
					fields: [
						field("userId", column(event, "userId")),
						field("entityId", column(event, "entityId")),
						field("eventSchemaSlug", column(event, "eventSchemaSlug")),
						field("properties", column(event, "properties")),
					],
				}),
			});
			const foreignEventDocument = document({
				events: rows(event, {
					limit: 20,
					fields: [field("id", column(event, "id"))],
					where: eq(column(event, "eventSchemaSlug"), literal(foreignEventSlug)),
				}),
			});

			const relationship = table("relationship", "relationship");
			const relationshipDocument = document({
				relationships: rows(relationship, {
					limit: 20,
					orderBy: [ascending(column(relationship, "id"))],
					where: eq(column(relationship, "relationshipSchemaSlug"), literal(relationshipSlug)),
					fields: [
						field("userId", column(relationship, "userId")),
						field("sourceEntityId", column(relationship, "sourceEntityId")),
						field("targetEntityId", column(relationship, "targetEntityId")),
						field("relationshipSchemaSlug", column(relationship, "relationshipSchemaSlug")),
					],
				}),
			});
			const foreignRelationshipDocument = document({
				relationships: rows(relationship, {
					limit: 20,
					fields: [field("id", column(relationship, "id"))],
					where: eq(
						column(relationship, "relationshipSchemaSlug"),
						literal(foreignRelationshipSlug),
					),
				}),
			});

			const nestedRoot = table("entity", "root");
			const nestedLink = table("relationship", "link");
			const nestedTarget = table("entity", "target");
			const nestedHiddenEntity = table("entity", "hidden");
			const nestedForeignEvent = table("event", "foreignEvent");
			const nestedForeignLink = table("relationship", "foreignLink");
			const nestedCountLink = table("relationship", "countLink");
			const nestedDocument = document({
				entities: rows(nestedRoot, {
					fields: [
						field("name", column(nestedRoot, "name")),
						field(
							"hasHiddenEntity",
							exists(nestedHiddenEntity, {
								where: eq(column(nestedHiddenEntity, "name"), literal("User A root")),
							}),
						),
						field(
							"hasForeignEvent",
							exists(nestedForeignEvent, {
								where: and(
									eq(column(nestedForeignEvent, "entityId"), column(nestedRoot, "id")),
									eq(column(nestedForeignEvent, "eventSchemaSlug"), literal(foreignEventSlug)),
								),
							}),
						),
						field(
							"ownRelationshipCount",
							count(nestedCountLink, {
								where: and(
									eq(column(nestedCountLink, "sourceEntityId"), column(nestedRoot, "id")),
									eq(column(nestedCountLink, "relationshipSchemaSlug"), literal(relationshipSlug)),
								),
							}),
						),
						field(
							"foreignRelationshipCount",
							count(nestedForeignLink, {
								where: and(
									eq(column(nestedForeignLink, "sourceEntityId"), column(nestedRoot, "id")),
									eq(
										column(nestedForeignLink, "relationshipSchemaSlug"),
										literal(foreignRelationshipSlug),
									),
								),
							}),
						),
					],
					include: [
						include(nestedLink, {
							fields: [
								field("userId", column(nestedLink, "userId")),
								field("targetId", column(nestedLink, "targetEntityId")),
								field("targetName", column(nestedTarget, "name")),
								field("targetUserId", column(nestedTarget, "userId")),
							],
							joins: [
								join(
									"left",
									nestedTarget,
									eq(column(nestedLink, "targetEntityId"), column(nestedTarget, "id")),
								),
							],
							key: "links",
							limit: 10,
							orderBy: [ascending(column(nestedLink, "id"))],
							where: and(
								eq(column(nestedLink, "sourceEntityId"), column(nestedRoot, "id")),
								eq(column(nestedLink, "relationshipSchemaSlug"), literal(relationshipSlug)),
							),
						}),
						include(nestedHiddenEntity, {
							fields: [field("name", column(nestedHiddenEntity, "name"))],
							key: "hiddenEntities",
							limit: 10,
							orderBy: [ascending(column(nestedHiddenEntity, "id"))],
							where: eq(column(nestedHiddenEntity, "name"), literal("User A root")),
						}),
						include(nestedForeignLink, {
							fields: [field("id", column(nestedForeignLink, "id"))],
							key: "foreignLinks",
							limit: 10,
							orderBy: [ascending(column(nestedForeignLink, "id"))],
							where: and(
								eq(column(nestedForeignLink, "sourceEntityId"), column(nestedRoot, "id")),
								eq(
									column(nestedForeignLink, "relationshipSchemaSlug"),
									literal(foreignRelationshipSlug),
								),
							),
						}),
					],
					limit: 20,
					orderBy: [ascending(column(nestedRoot, "id"))],
					where: eq(column(nestedRoot, "entitySchemaSlug"), literal(rootSlug)),
				}),
			});

			const applicationTableDocument = document({
				plugins: rows(table("plugin", "plugin"), {
					fields: [field("slug", column(table("plugin", "plugin"), "slug"))],
				}),
			});

			const probes = [
				{ name: "Plugin entities", query: pluginEntityDocument },
				{ name: "Foreign entities", query: foreignEntityDocument },
				{ name: "Plugin events", query: eventDocument },
				{ name: "Foreign events", query: foreignEventDocument },
				{ name: "Plugin relationships", query: relationshipDocument },
				{ name: "Foreign relationships", query: foreignRelationshipDocument },
				{ name: "Nested authorization", query: nestedDocument },
				{ name: "Application table", query: applicationTableDocument },
			].map((probe) => {
				const slug = probe.name.toLowerCase().replaceAll(" ", "-");
				return Object.assign(probe, {
					cronSlug: `e2e-ryotql-auth-cron-${slug}-${suffix}`,
					externalId: `e2e-ryotql-auth-marker-${slug}-${suffix}`,
					slug: `e2e-ryotql-auth-probe-${slug}-${suffix}`,
				});
			}) satisfies readonly AuthorizationProbe[];

			yield* Effect.acquireRelease(
				installTestPluginBundle({
					pluginSlug,
					files: {
						...Object.fromEntries(
							probes.map((probe) => [
								`scripts/${probe.slug}.sandbox.ts`,
								authorizationProbeSource({ ...probe, markerSchemaSlug: markerSlug }),
							]),
						),
						[providerEntry]: providerSandboxSource({
							operation: "details",
							slug: providerScriptSlug,
							name: "RyotQL authorization provider details",
							result: fakeProviderDetailsResult({ name: "RyotQL authorization provider" }),
						}),
					},
					scripts: [
						{
							providerSlug,
							kind: "provider",
							capabilities: [],
							entry: providerEntry,
							slug: providerScriptSlug,
							providerOperation: "details",
							requiredPluginConfigKeys: [],
							requiredSystemConfigKeys: [],
							name: "RyotQL authorization provider details",
						} satisfies PluginScript,
						...probes.map(
							(probe) =>
								({
									providerSlug,
									kind: "script",
									slug: probe.slug,
									name: probe.name,
									requiredPluginConfigKeys: [],
									requiredSystemConfigKeys: [],
									entry: `scripts/${probe.slug}.sandbox.ts`,
									capabilities: ["executeRyotql", "upsertGlobalEntities"],
								}) satisfies PluginScript,
						),
					],
					providers: [
						{
							slug: providerSlug,
							information: { source: "e2e" },
							name: "RyotQL authorization provider",
							operations: { details: providerScriptSlug },
						},
					],
					entitySchemas,
					relationshipSchemas,
					crons: probes.map((probe) => ({
						slug: probe.cronSlug,
						scriptSlug: probe.slug,
						schedule: { cron: "0 0 * * *" },
						description: `Run ${probe.name}`,
					})),
				}),
				(plugin) => cleanupData.pipe(Effect.andThen(uninstallTestPlugin(plugin)), Effect.ignore),
			);

			const createGlobalEntity = (input: {
				readonly name: string;
				readonly externalId: string;
				readonly entitySchemaSlug: string;
				readonly properties?: Record<string, unknown>;
			}) =>
				backend.call(
					(c) =>
						c.testSupport.createGlobalEntity({
							payload: {
								name: input.name,
								externalId: input.externalId,
								properties: input.properties ?? {},
								entitySchemaSlug: EntitySchemaSlug.make(input.entitySchemaSlug),
							},
						}),
					adminHeaders,
				);

			const globalRoot = yield* createGlobalEntity({
				name: "Global root",
				properties: { score: 10 },
				entitySchemaSlug: rootSlug,
				externalId: `global-root-${suffix}`,
			});
			const globalTarget = yield* createGlobalEntity({
				name: "Global target",
				entitySchemaSlug: targetSlug,
				externalId: `global-target-${suffix}`,
			});
			const foreignRoot = yield* createGlobalEntity({
				name: "Foreign root",
				entitySchemaSlug: foreignRootSlug,
				externalId: `foreign-root-${suffix}`,
			});
			const foreignTarget = yield* createGlobalEntity({
				name: "Foreign target",
				entitySchemaSlug: foreignTargetSlug,
				externalId: `foreign-target-${suffix}`,
			});
			globalEntityIds.push(globalRoot.id, globalTarget.id, foreignRoot.id, foreignTarget.id);

			const userARoot = yield* createEntity(userA.client, {
				name: "User A root",
				properties: { score: 100 },
				entitySchemaSlug: EntitySchemaSlug.make(rootSlug),
			});
			const userBRoot = yield* createEntity(userB.client, {
				name: "User B root",
				properties: { score: 200 },
				entitySchemaSlug: EntitySchemaSlug.make(rootSlug),
			});
			const userATarget = yield* createEntity(userA.client, {
				properties: {},
				name: "User A target",
				entitySchemaSlug: EntitySchemaSlug.make(targetSlug),
			});

			yield* createEventFixture(userA.client, {
				entityId: globalRoot.id,
				properties: { value: 2 },
				eventSchemaSlug: eventSlug,
				occurredAt: "2026-01-01T12:00:00.000Z",
			});
			yield* createEventFixture(userB.client, {
				entityId: globalRoot.id,
				properties: { value: 3 },
				eventSchemaSlug: eventSlug,
				occurredAt: "2026-01-02T12:00:00.000Z",
			});
			yield* createEventFixture(userB.client, {
				entityId: foreignRoot.id,
				properties: { value: 9 },
				eventSchemaSlug: foreignEventSlug,
			});

			yield* createRelationship(userA.client, {
				properties: { rank: 1 },
				sourceEntityId: globalRoot.id,
				targetEntityId: globalTarget.id,
				relationshipSchemaSlug: RelationshipSchemaSlug.make(relationshipSlug),
			});
			yield* createRelationship(userB.client, {
				properties: { rank: 2 },
				sourceEntityId: globalRoot.id,
				targetEntityId: globalTarget.id,
				relationshipSchemaSlug: RelationshipSchemaSlug.make(relationshipSlug),
			});
			yield* createRelationship(userA.client, {
				properties: { rank: 3 },
				sourceEntityId: globalRoot.id,
				targetEntityId: userATarget.id,
				relationshipSchemaSlug: RelationshipSchemaSlug.make(relationshipSlug),
			});
			yield* createRelationship(userB.client, {
				properties: { rank: 9 },
				sourceEntityId: foreignRoot.id,
				targetEntityId: foreignTarget.id,
				relationshipSchemaSlug: RelationshipSchemaSlug.make(foreignRelationshipSlug),
			});

			const runProbe = (probe: AuthorizationProbe) =>
				Effect.gen(function* () {
					const trigger = yield* backend.call(
						(c) =>
							c.testSupport.triggerPluginCron({
								payload: { cronSlug: probe.cronSlug, pluginSlug: PluginSlug.make(pluginSlug) },
							}),
						adminHeaders,
					);
					if (trigger.status !== "executed") {
						throw new Error(
							`Probe '${probe.name}' failed: ${"result" in trigger ? JSON.stringify(trigger.result) : "not found"}`,
						);
					}
					const response = yield* pollUntil(
						`RyotQL authorization probe '${probe.name}'`,
						executeRyotQL(userA.client, markerDocument(probe.externalId)).pipe(
							Effect.map((result) =>
								result.data.marker?.type === "rows" && result.data.marker.items.length > 0
									? result
									: null,
							),
						),
					);
					const markerResult = response.data.marker;
					if (markerResult?.type !== "rows") {
						throw new Error(`Probe '${probe.name}' marker is not a rows result`);
					}
					const marker = requirePresent(markerResult.items[0], `Missing '${probe.name}' marker`);
					const markerId = requireRyotQLFieldValue(marker, "id");
					if (markerId.kind !== "text") {
						throw new Error(`Probe '${probe.name}' marker ID is not text`);
					}
					globalEntityIds.push(
						requireString(markerId.value, `Probe '${probe.name}' marker ID is invalid`),
					);
					return response;
				});

			const payloads = new Map<string, Record<string, unknown>>();
			for (const probe of probes) {
				const response = yield* runProbe(probe);
				payloads.set(probe.name, markerPayload(response));
			}

			const probe = (name: string) => requirePresent(payloads.get(name), `Missing '${name}' probe`);
			const rowsFromProbe = (name: string, queryName: string) =>
				responseRows(requirePresent(probe(name)["result"], `Missing '${name}' result`), queryName);

			const pluginEntities = rowsFromProbe("Plugin entities", "entities");
			expect(pluginEntities).toHaveLength(2);
			expect(pluginEntities.map((row) => fieldValue(row, "id"))).toEqual(
				expect.arrayContaining([globalRoot.id, globalTarget.id]),
			);
			expect(pluginEntities.map((row) => fieldValue(row, "id"))).not.toContain(userARoot.id);
			expect(pluginEntities.map((row) => fieldValue(row, "id"))).not.toContain(userBRoot.id);
			expect(pluginEntities.every((row) => fieldValue(row, "userId") === null)).toBe(true);

			expect(rowsFromProbe("Foreign entities", "entities")).toEqual([]);

			const pluginEvents = rowsFromProbe("Plugin events", "events");
			expect(pluginEvents).toHaveLength(2);
			expect(
				pluginEvents
					.map((row) => fieldValue(row, "userId"))
					.sort((left, right) => String(left).localeCompare(String(right))),
			).toEqual([userA.userId, userB.userId].sort((left, right) => left.localeCompare(right)));
			expect(pluginEvents.every((row) => fieldValue(row, "eventSchemaSlug") === eventSlug)).toBe(
				true,
			);
			expect(rowsFromProbe("Foreign events", "events")).toEqual([]);

			const pluginRelationships = rowsFromProbe("Plugin relationships", "relationships");
			expect(pluginRelationships).toHaveLength(3);
			expect(
				pluginRelationships
					.map((row) => fieldValue(row, "userId"))
					.sort((left, right) => String(left).localeCompare(String(right))),
			).toEqual(
				[userA.userId, userA.userId, userB.userId].sort((left, right) => left.localeCompare(right)),
			);
			expect(rowsFromProbe("Foreign relationships", "relationships")).toEqual([]);

			const nestedRows = rowsFromProbe("Nested authorization", "entities");
			expect(nestedRows).toHaveLength(1);
			const nestedRow = requirePresent(nestedRows[0], "Expected nested root row");
			expect(fieldValue(nestedRow, "hasHiddenEntity")).toBe(false);
			expect(fieldValue(nestedRow, "hasForeignEvent")).toBe(false);
			expect(fieldValue(nestedRow, "ownRelationshipCount")).toBe(3);
			expect(fieldValue(nestedRow, "foreignRelationshipCount")).toBe(0);

			const links = requireObjectRecord(nestedRow["links"], "Expected nested links include");
			const linkRows = requireArray(links["items"], "Expected nested link rows").map((row) =>
				requireObjectRecord(row, "Expected nested link row"),
			);
			expect(linkRows).toHaveLength(3);
			const userTargetLink = requirePresent(
				linkRows.find((row) => fieldValue(row, "targetId") === userATarget.id),
				"Expected user-owned target relationship",
			);
			expect(fieldValue(userTargetLink, "targetName")).toBeNull();
			expect(fieldValue(userTargetLink, "targetUserId")).toBeNull();
			expect(
				linkRows
					.filter((row) => fieldValue(row, "targetId") === globalTarget.id)
					.map((row) => fieldValue(row, "targetName")),
			).toEqual(["Global target", "Global target"]);

			const hiddenEntities = requireObjectRecord(
				nestedRow["hiddenEntities"],
				"Expected hidden entity include",
			);
			expect(hiddenEntities["items"]).toEqual([]);
			const foreignLinks = requireObjectRecord(
				nestedRow["foreignLinks"],
				"Expected foreign link include",
			);
			expect(foreignLinks["items"]).toEqual([]);

			const applicationTable = probe("Application table");
			expect(applicationTable["ok"]).toBe(false);
			expect(applicationTable["error"]).toEqual(
				expect.stringContaining("Table 'plugin' is not available to plugin execution"),
			);

			const httpUserRows = responseRows(
				yield* executeRyotQL(userA.client, pluginEntityDocument),
				"entities",
			);
			expect(httpUserRows.map((row) => fieldValue(row, "id"))).toContain(userARoot.id);
			expect(httpUserRows.map((row) => fieldValue(row, "id"))).not.toContain(userBRoot.id);
		}),
	);
});
