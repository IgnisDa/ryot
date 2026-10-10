import { assert, expect, layer } from "@effect/vitest";
import {
	builtinSavedViewId,
	definitionKey,
	definitionOwner,
} from "@ryot-app/contract/modules/plugins/references";
import {
	PluginId,
	type PluginPackageId,
	PluginRevisionId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import {
	aggregate,
	and,
	ascending,
	column,
	count,
	eq,
	field,
	include,
	join,
	measure,
	pluginId,
	rows,
	schemaOwnerJoin,
	table,
} from "@ryot-app/ryotql";
import { eq as dbEq } from "drizzle-orm";
import { Effect, Layer } from "effect";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { kernelDefinitionSource } from "#modules/definition-registry/kernel-source";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { seedKernelDefinitions } from "#modules/definition-registry/test-support";
import { PluginRepository } from "#modules/plugins/repository";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/revision.test-support";
import { testPluginPackageId } from "#modules/plugins/test-support";

import { RyotQLService } from "./service";

const databaseLayer = RyotQLService.layer.pipe(Layer.provideMerge(revisionDatabaseLayer));
const owner = UserId.make("owner");

const namespacePackage = (version = "v1", packageId = testPluginPackageId()) => {
	const value = revisionPackage("whiskey", version, "bottle", packageId);
	const entity = table("entity", "entity");
	return {
		...value,
		manifest: {
			...value.manifest,
			importSources: [
				{
					slug: "import",
					name: "Import",
					description: "Import",
					workflowSlug: "whiskey-flow",
					inputSchema: { fields: {}, unknownKeys: "strict" as const },
				},
			],
			integrationProviders: [
				{
					slug: "catalog",
					name: "Catalog",
					lot: "yank" as const,
					description: "Catalog",
					scriptSlug: "whiskey.workflow",
					settingsSchema: { fields: {} },
				},
			],
			savedViews: [
				{
					icon: "box",
					sortOrder: 0,
					name: "All bottles",
					slug: "all-bottles",
					renderer: { kind: "kernel", name: "results-table" } as const,
					dataSources: {
						queries: { bottles: rows(entity, { fields: [field("id", column(entity, "id"))] }) },
					},
					settings: {
						pageSize: 20,
						entityLink: null,
						rowKeyFields: ["id"],
						sourceName: "bottles",
						columns: [{ field: "id", label: "ID", displayKind: "text" }],
					},
				},
			],
		},
	};
};

layer(databaseLayer)((test) => {
	test.effect(
		"loads complete generated migrations and keeps kernel and matching package definition joins independent",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const service = yield* RyotQLService;
				const packageA = namespacePackage();
				const bottle = packageA.manifest.entitySchemas[0];
				assert(bottle);
				const a = yield* installRevisionPackage({
					...packageA,
					manifest: {
						...packageA.manifest,
						entitySchemas: [bottle, { ...bottle, slug: "distillery" }],
					},
				});
				const b = yield* installRevisionPackage(namespacePackage(), owner);
				const unicodeUser = "user:🍾";
				yield* session.run((db) =>
					db
						.insert(tables.user)
						.values({
							id: unicodeUser,
							name: "Unicode",
							email: "unicode@example.test",
							accountGeneration: "unicode-account",
						}),
				);
				yield* session.run((db) =>
					db
						.insert(tables.pluginInstallation)
						.values({
							health: "ready",
							userId: unicodeUser,
							pluginId: a.pluginId,
							id: "unicode-installation",
						}),
				);
				const kernel = kernelDefinitionSource();
				yield* seedKernelDefinitions({
					...kernel,
					entitySchemas: [
						...kernel.entitySchemas,
						{
							icon: "box",
							pluginId: null,
							slug: "bottle",
							name: "Kernel bottle",
							propertiesSchema: { fields: {} },
							eventSchemas: [
								{
									pluginId: null,
									slug: "changed",
									name: "Changed",
									propertiesSchema: { fields: {} },
								},
							],
						},
					],
				});
				yield* session.run((db) =>
					db.insert(tables.entity).values([
						{ id: "a", name: "A", entitySchemaSlug: "bottle", entitySchemaPluginId: a.pluginId },
						{
							id: "a-distillery",
							name: "Distillery",
							entitySchemaSlug: "distillery",
							entitySchemaPluginId: a.pluginId,
						},
						{
							id: "b",
							name: "B",
							userId: owner,
							entitySchemaSlug: "bottle",
							entitySchemaPluginId: b.pluginId,
						},
						{
							id: "kernel",
							userId: owner,
							name: "Kernel",
							entitySchemaSlug: "bottle",
							entitySchemaPluginId: null,
						},
					]),
				);
				yield* session.run((db) =>
					db.insert(tables.event).values([
						{
							id: "a-event",
							entityId: "a",
							userId: owner,
							occurredAt: new Date(0),
							eventSchemaSlug: "changed",
							eventSchemaPluginId: a.pluginId,
						},
						{
							userId: owner,
							occurredAt: new Date(0),
							id: "a-distillery-event",
							entityId: "a-distillery",
							eventSchemaSlug: "changed",
							eventSchemaPluginId: a.pluginId,
						},
						{
							id: "b-event",
							entityId: "b",
							userId: owner,
							occurredAt: new Date(0),
							eventSchemaSlug: "changed",
							eventSchemaPluginId: b.pluginId,
						},
						{
							userId: owner,
							id: "kernel-event",
							entityId: "kernel",
							occurredAt: new Date(0),
							eventSchemaPluginId: null,
							eventSchemaSlug: "changed",
						},
					]),
				);
				const entity = table("entity", "entity");
				const definition = table("entitySchema", "definition");
				const event = table("event", "event");
				const eventDefinition = table("eventSchema", "eventDefinition");
				const response = yield* service.executeForUser(owner, null, "plugin", {
					queries: {
						entities: rows(entity, {
							fields: [
								field("id", column(entity, "id")),
								field("owner", column(definition, "pluginId")),
							],
							joins: [
								join(
									"inner",
									definition,
									and(
										eq(column(entity, "entitySchemaSlug"), column(definition, "slug")),
										schemaOwnerJoin(entity, "entitySchemaPluginId", definition, "pluginId"),
									),
								),
							],
						}),
						events: rows(event, {
							fields: [
								field("id", column(event, "id")),
								field("owner", column(eventDefinition, "pluginId")),
							],
							joins: [
								join("inner", entity, eq(column(event, "entityId"), column(entity, "id"))),
								join(
									"inner",
									eventDefinition,
									and(
										eq(column(event, "eventSchemaSlug"), column(eventDefinition, "slug")),
										eq(
											column(entity, "entitySchemaSlug"),
											column(eventDefinition, "entitySchemaSlug"),
										),
										schemaOwnerJoin(event, "eventSchemaPluginId", eventDefinition, "pluginId"),
										schemaOwnerJoin(entity, "entitySchemaPluginId", eventDefinition, "pluginId"),
									),
								),
							],
						}),
					},
				});
				expect(response.data["entities"]).toMatchObject({
					items: [
						{ id: "a", owner: a.pluginId },
						{ owner: a.pluginId, id: "a-distillery" },
						{ id: "b", owner: b.pluginId },
						{ owner: null, id: "kernel" },
					],
				});
				expect(response.data["events"]).toMatchObject({
					items: [
						{ owner: a.pluginId, id: "a-distillery-event" },
						{ id: "a-event", owner: a.pluginId },
						{ id: "b-event", owner: b.pluginId },
						{ owner: null, id: "kernel-event" },
					],
				});
				const views = yield* session.run((db) =>
					db
						.select({
							id: tables.userSavedViewEffective.id,
							pluginId: tables.userSavedViewEffective.pluginId,
						})
						.from(tables.userSavedViewEffective)
						.where(dbEq(tables.userSavedViewEffective.slug, "all-bottles")),
				);
				expect(views).toEqual(
					expect.arrayContaining([
						{
							pluginId: a.pluginId,
							id: builtinSavedViewId(owner, definitionOwner(a.pluginId), "all-bottles"),
						},
						{
							pluginId: b.pluginId,
							id: builtinSavedViewId(owner, definitionOwner(b.pluginId), "all-bottles"),
						},
						{
							pluginId: a.pluginId,
							id: builtinSavedViewId(unicodeUser, definitionOwner(a.pluginId), "all-bottles"),
						},
					]),
				);
				expect(new Set(views.map(({ id }) => id)).size).toBe(views.length);
				const [kernelView] = yield* session.run((db) =>
					db
						.select({ id: tables.userSavedViewEffective.id })
						.from(tables.userSavedViewEffective)
						.where(
							dbEq(
								tables.userSavedViewEffective.id,
								builtinSavedViewId(unicodeUser, definitionOwner(null), "collections"),
							),
						),
				);
				expect(kernelView?.id).toBe(
					builtinSavedViewId(unicodeUser, definitionOwner(null), "collections"),
				);
			}),
	);
});

layer(databaseLayer)((test) => {
	test.effect(
		"keeps same-named executable catalogs and requires a provider root from its exact owner",
		() =>
			Effect.gen(function* () {
				const service = yield* RyotQLService;
				const a = yield* installRevisionPackage(namespacePackage());
				const b = yield* installRevisionPackage(namespacePackage());
				const broken = namespacePackage();
				const wrongOwner = yield* installRevisionPackage({
					...broken,
					scripts: broken.scripts.filter(({ metadata }) => metadata.kind !== "provider"),
					manifest: {
						...broken.manifest,
						providers: [],
						savedViews: [],
						scripts: broken.manifest.scripts.filter(({ kind }) => kind !== "provider"),
					},
				});
				const provider = table("sandboxProvider", "provider");
				const source = table("importSource", "source");
				const integration = table("integrationProvider", "integration");
				const response = yield* service.executeForUser(owner, null, "kernel", {
					queries: {
						sources: rows(source, { fields: [field("owner", column(source, "pluginId"))] }),
						integrations: rows(integration, {
							fields: [field("owner", column(integration, "pluginId"))],
						}),
						providers: rows(provider, {
							fields: [
								field("owner", column(provider, "pluginId")),
								field("packageId", column(provider, "packageId")),
								field("root", column(provider, "rootEntitySchemaSlug")),
							],
						}),
					},
				});
				const providers = response.data["providers"];
				assert(providers?.type === "rows");
				expect(providers.items).toHaveLength(2);
				expect(
					providers.items
						.map((item) => {
							const pluginOwner = item["owner"];
							assert(typeof pluginOwner === "string");
							return pluginOwner;
						})
						.sort((left, right) => {
							if (left < right) {
								return -1;
							}
							if (left > right) {
								return 1;
							}
							return 0;
						}),
				).toEqual(
					[a.pluginId, b.pluginId].sort((left, right) => {
						if (left < right) {
							return -1;
						}
						if (left > right) {
							return 1;
						}
						return 0;
					}),
				);
				expect(providers.items.every((item) => item["root"] === "bottle")).toBe(true);
				for (const name of ["sources", "integrations"]) {
					const result = response.data[name];
					assert(result?.type === "rows");
					expect(
						result.items
							.flatMap((item) => {
								const pluginOwner = item["owner"];
								if (pluginOwner === null) {
									return [];
								}
								assert(typeof pluginOwner === "string");
								return [pluginOwner];
							})
							.sort((left, right) => {
								if (left < right) {
									return -1;
								}
								if (left > right) {
									return 1;
								}
								return 0;
							}),
					).toEqual(
						[a.pluginId, b.pluginId, wrongOwner.pluginId].sort((left, right) => {
							if (left < right) {
								return -1;
							}
							if (left > right) {
								return 1;
							}
							return 0;
						}),
					);
				}
			}),
	);
});

layer(databaseLayer)((test) => {
	test.effect(
		"binds package references once and rejects a cursor reused with another resolved owner",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const service = yield* RyotQLService;
				const packageA = namespacePackage();
				const packageB = namespacePackage();
				const a = yield* installRevisionPackage(packageA);
				const b = yield* installRevisionPackage(packageB);
				yield* session.run((db) =>
					db.insert(tables.entity).values([
						{ id: "a-1", name: "A1", entitySchemaSlug: "bottle", entitySchemaPluginId: a.pluginId },
						{ id: "a-2", name: "A2", entitySchemaSlug: "bottle", entitySchemaPluginId: a.pluginId },
						{ id: "b-1", name: "B1", entitySchemaSlug: "bottle", entitySchemaPluginId: b.pluginId },
					]),
				);
				const entity = table("entity", "entity");
				const query = (packageId: PluginPackageId, after?: string) => ({
					queries: {
						bottles: rows(entity, {
							after,
							limit: 1,
							where: eq(
								column(entity, "entitySchemaPluginId"),
								pluginId({ packageId, kind: "package", scope: "system" }),
							),
							fields: [
								field("id", column(entity, "id")),
								field("owner", pluginId({ packageId, kind: "package", scope: "system" })),
							],
						}),
					},
				});
				const first = (yield* service.executeForUser(
					owner,
					null,
					"plugin",
					query(packageA.manifest.metadata.packageId),
				)).data["bottles"];
				assert(first?.type === "rows");
				assert(first.pageInfo.nextCursor);
				expect(first.items).toEqual([{ id: "a-1", owner: a.pluginId }]);
				expect(
					(yield* service.executeForUser(
						owner,
						null,
						"plugin",
						query(packageA.manifest.metadata.packageId, first.pageInfo.nextCursor),
					)).data["bottles"],
				).toMatchObject({ items: [{ id: "a-2", owner: a.pluginId }] });
				expect(
					yield* Effect.flip(
						service.executeForUser(
							owner,
							null,
							"plugin",
							query(packageB.manifest.metadata.packageId, first.pageInfo.nextCursor),
						),
					),
				).toMatchObject({ reason: { code: "invalid-cursor" } });
			}),
	);
});

layer(databaseLayer)((test) => {
	test.effect(
		"denies foreign same-slug system reads in roots, includes, subqueries, aggregates, and metadata",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const service = yield* RyotQLService;
				const a = yield* installRevisionPackage(namespacePackage());
				const b = yield* installRevisionPackage(namespacePackage());
				yield* session.run((db) =>
					db.insert(tables.entity).values([
						{ id: "a", name: "A", entitySchemaSlug: "bottle", entitySchemaPluginId: a.pluginId },
						{ id: "b", name: "B", entitySchemaSlug: "bottle", entitySchemaPluginId: b.pluginId },
						{
							id: "kernel",
							name: "Kernel",
							entitySchemaSlug: "bottle",
							entitySchemaPluginId: null,
						},
					]),
				);
				yield* session.run((db) =>
					db.insert(tables.event).values([
						{
							id: "a-event",
							entityId: "a",
							userId: owner,
							occurredAt: new Date(0),
							eventSchemaSlug: "changed",
							eventSchemaPluginId: a.pluginId,
						},
						{
							id: "b-event",
							entityId: "b",
							userId: owner,
							occurredAt: new Date(0),
							eventSchemaSlug: "changed",
							eventSchemaPluginId: b.pluginId,
						},
						{
							entityId: "b",
							userId: owner,
							id: "wrong-parent",
							occurredAt: new Date(0),
							eventSchemaSlug: "changed",
							eventSchemaPluginId: a.pluginId,
						},
					]),
				);
				yield* session.run((db) =>
					db.insert(tables.relationship).values([
						{
							id: "a-link",
							sourceEntityId: "a",
							targetEntityId: "a",
							relationshipSchemaSlug: "whiskey-link",
							relationshipSchemaPluginId: a.pluginId,
						},
						{
							id: "b-link",
							sourceEntityId: "b",
							targetEntityId: "b",
							relationshipSchemaSlug: "whiskey-link",
							relationshipSchemaPluginId: b.pluginId,
						},
						{
							sourceEntityId: "a",
							targetEntityId: "b",
							id: "wrong-endpoint",
							relationshipSchemaSlug: "whiskey-link",
							relationshipSchemaPluginId: a.pluginId,
						},
					]),
				);
				const entity = table("entity", "entity");
				const event = table("event", "event");
				const relationship = table("relationship", "relationship");
				const definitions = table("entitySchema", "definition");
				const eventDefinitions = table("eventSchema", "eventDefinition");
				const response = yield* service.executeForPlugin(
					{
						entitySchemaSlugs: ["bottle"],
						pluginId: PluginId.make(a.pluginId),
						signalSchemaSlugs: ["whiskey.signal"],
						relationshipSchemaSlugs: ["whiskey-link"],
						pluginRevisionId: PluginRevisionId.make(a.revisionId),
						eventSchemas: [{ entitySchemaSlug: "bottle", eventSchemaSlug: "changed" }],
					},
					{
						queries: {
							events: rows(event, { fields: [field("id", column(event, "id"))] }),
							aggregate: aggregate(entity, { measures: [measure("count", { function: "count" })] }),
							definitions: rows(definitions, {
								fields: [
									field("owner", column(definitions, "pluginId")),
									field("revision", column(definitions, "pluginRevisionId")),
								],
							}),
							eventDefinitions: rows(eventDefinitions, {
								fields: [
									field("owner", column(eventDefinitions, "pluginId")),
									field("entity", column(eventDefinitions, "entitySchemaSlug")),
								],
							}),
							entities: rows(entity, {
								fields: [field("id", column(entity, "id")), field("events", count(event))],
								include: [
									include(relationship, {
										limit: 5,
										key: "links",
										orderBy: [ascending(column(relationship, "id"))],
										fields: [field("id", column(relationship, "id"))],
									}),
								],
							}),
						},
					},
					1_048_576,
				);
				expect(response.data["entities"]).toMatchObject({
					items: [{ id: "a", events: 1, links: { items: [{ id: "a-link" }] } }],
				});
				expect(response.data["events"]).toMatchObject({ items: [{ id: "a-event" }] });
				expect(response.data["aggregate"]).toEqual({ type: "aggregate", items: [{ count: 1 }] });
				expect(response.data["definitions"]).toMatchObject({
					items: [{ owner: a.pluginId, revision: a.revisionId }],
				});
				expect(response.data["eventDefinitions"]).toMatchObject({
					items: [{ entity: "bottle", owner: a.pluginId }],
				});
			}),
	);
});

layer(databaseLayer)((test) => {
	test.effect(
		"keeps private metadata current and reads pinned own metadata without exposing foreign historical revisions",
		() =>
			Effect.gen(function* () {
				const service = yield* RyotQLService;
				const plugins = yield* PluginRepository;
				const definitions = yield* DefinitionRepository;
				const session = yield* DatabaseSession;
				const packageA = namespacePackage();
				const packageB = namespacePackage();
				const a = yield* installRevisionPackage(packageA, owner);
				const b = yield* installRevisionPackage(packageB, owner);
				for (const [value, installed] of [
					[packageA, a],
					[packageB, b],
				] as const) {
					const next = namespacePackage("v2", value.manifest.metadata.packageId);
					yield* session.transaction(
						Effect.gen(function* () {
							yield* plugins.lockIngestion();
							yield* plugins.persist(
								{
									...next,
									manifest: {
										...next.manifest,
										entitySchemas: Array.from(next.manifest.entitySchemas, (entity) => ({
											...entity,
											name: "Current bottle",
										})),
									},
								},
								{ scope: "user", ownerId: owner, pluginId: installed.pluginId },
							);
						}),
					);
				}
				const entitySchema = table("entitySchema", "schema");
				const query = {
					queries: {
						definitions: rows(entitySchema, {
							orderBy: [ascending(column(entitySchema, "pluginId"))],
							fields: [
								field("owner", column(entitySchema, "pluginId")),
								field("name", column(entitySchema, "name")),
								field("revision", column(entitySchema, "pluginRevisionId")),
							],
						}),
					},
				};
				const current = (yield* service.executeForUser(owner, null, "plugin", query)).data[
					"definitions"
				];
				assert(current?.type === "rows");
				expect(current.items).toHaveLength(2);
				expect(
					current.items.every(
						(item) =>
							item["name"] === "Current bottle" &&
							item["revision"] !== a.revisionId &&
							item["revision"] !== b.revisionId,
					),
				).toBe(true);
				const context = {
					pluginId: PluginId.make(a.pluginId),
					pluginRevisionId: PluginRevisionId.make(a.revisionId),
				};
				const pinned = (yield* service.executeForUser(
					owner,
					null,
					"plugin",
					query,
					"standard",
					undefined,
					context,
				)).data["definitions"];
				assert(pinned?.type === "rows");
				expect(pinned.items).toEqual(
					expect.arrayContaining([
						{ name: "Fixture", owner: a.pluginId, revision: a.revisionId },
						{ owner: b.pluginId, name: "Current bottle", revision: expect.any(String) },
					]),
				);
				expect(pinned.items).toHaveLength(2);
				const snapshot = yield* definitions.getSnapshotForContext(context, owner);
				expect(
					snapshot.entitySchemas[definitionKey("entity", definitionOwner(a.pluginId), "bottle")]
						?.name,
				).toBe("Fixture");
				expect(
					snapshot.entitySchemas[definitionKey("entity", definitionOwner(b.pluginId), "bottle")]
						?.name,
				).toBe("Current bottle");
				yield* session.run((db) =>
					db
						.insert(tables.entity)
						.values({
							userId: owner,
							id: "hidden-bottle",
							name: "Hidden bottle",
							entitySchemaSlug: "bottle",
							entitySchemaPluginId: a.pluginId,
						}),
				);
				yield* session.run((db) =>
					db
						.update(tables.pluginInstallation)
						.set({ isHidden: true })
						.where(dbEq(tables.pluginInstallation.id, a.installation.id)),
				);
				const entity = table("entity", "entity");
				const hiddenIdentity = pluginId({
					scope: "user",
					kind: "package",
					packageId: packageA.manifest.metadata.packageId,
				});
				const hidden = yield* service.executeForUser(owner, null, "plugin", {
					queries: {
						definitions: rows(entitySchema, {
							fields: [field("owner", column(entitySchema, "pluginId"))],
							where: eq(column(entitySchema, "pluginId"), hiddenIdentity),
						}),
						bottles: rows(entity, {
							where: eq(column(entity, "entitySchemaPluginId"), hiddenIdentity),
							fields: [field("id", column(entity, "id")), field("owner", hiddenIdentity)],
						}),
					},
				});
				expect(hidden.data["bottles"]).toMatchObject({
					items: [{ owner: a.pluginId, id: "hidden-bottle" }],
				});
				expect(hidden.data["definitions"]).toMatchObject({ items: [] });
				expect(
					(yield* definitions.getSnapshotForContext(context, owner)).entitySchemas[
						definitionKey("entity", definitionOwner(a.pluginId), "bottle")
					]?.name,
				).toBe("Fixture");
				yield* session.run((db) =>
					db
						.update(tables.pluginInstallation)
						.set({ health: "incompatible", healthReason: "Unavailable" })
						.where(dbEq(tables.pluginInstallation.id, a.installation.id)),
				);
				expect(yield* Effect.flip(definitions.getSnapshotForContext(context, owner))).toMatchObject(
					{ context, _tag: "DefinitionReadUnavailable" },
				);
				expect(
					yield* Effect.flip(
						service.executeForUser(owner, null, "plugin", {
							queries: {
								definitions: rows(entitySchema, {
									fields: [field("owner", pluginId({ kind: "local", pluginId: context.pluginId }))],
								}),
							},
						}),
					),
				).toMatchObject({ reason: { issue: "unavailable", code: "unresolved-query-owner" } });
			}),
	);
});
