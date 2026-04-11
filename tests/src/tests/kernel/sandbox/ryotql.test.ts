import { EntityId, EntitySchemaSlug, PluginSlug, UserId } from "@ryot/contract/schema/brands";
import { column, document, eq, field, literal, rows, table } from "@ryot/ryotql";
import { Effect } from "effect";

import {
	adminHeaders,
	createAuthenticatedClient,
	createEntity,
	createEventTestFixture,
	createPluginSchema,
	entityRowsSandboxSource,
	enqueueSandboxScript,
	eventRowsSandboxSource,
	executeRyotQL,
	fakeProviderDetailsResult,
	getBackendClient,
	installSandboxScriptScoped,
	installTestPluginBundle,
	pollSandboxResult,
	pollUntil,
	providerSandboxSource,
	requireRyotQLFieldValue,
	requireRyotQLTextField,
	systemRyotqlProbeSandboxSource,
	uninstallTestPlugin,
} from "~/fixtures";
import { assertCompleted, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("sandbox RyotQL reads", () => {
	it.live("reads multiple visible entities through executeRyotql", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const { schemaId } = yield* createPluginSchema(client);
			const first = yield* createEntity(client, {
				properties: {},
				name: "First entity",
				entitySchemaSlug: schemaId,
			});
			const second = yield* createEntity(client, {
				properties: {},
				name: "Second entity",
				entitySchemaSlug: schemaId,
			});
			const slug = `ryotql-entities-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				name: "Query entities",
				capabilities: ["executeRyotql"],
				source: entityRowsSandboxSource({ name: "Query entities", slug }),
			});
			const { jobId } = yield* enqueueSandboxScript(userId, {
				scriptId,
				context: { ids: [first.id, second.id], entitySchemaSlug: schemaId },
			});

			const result = yield* pollSandboxResult(userId, jobId);
			expect(result.status).toBe("completed");
			assertCompleted(result, "query entities sandbox job");
			expect(result.error).toBeNull();
			expect(result.value).toHaveLength(2);
			expect(result.value).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ id: first.id, name: "First entity" }),
					expect.objectContaining({ id: second.id, name: "Second entity" }),
				]),
			);

			const { jobId: emptyJobId } = yield* enqueueSandboxScript(userId, {
				scriptId,
				context: { ids: [], entitySchemaSlug: schemaId },
			});
			const emptyResult = yield* pollSandboxResult(userId, emptyJobId);
			assertCompleted(emptyResult, "empty query entities sandbox job");
			expect(emptyResult.error).toBeNull();
			expect(emptyResult.value).toEqual([]);
		}),
	);

	it.live("reads filtered events through executeRyotql", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const { entityId, entitySchemaSlug, eventSchemaSlug } = yield* createEventTestFixture(client);
			yield* client.call((c) =>
				c.events.create({
					payload: [{ entityId, eventSchemaSlug, properties: { rating: 5 } }],
				}),
			);
			const slug = `ryotql-events-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				name: "Query events",
				capabilities: ["executeRyotql"],
				source: eventRowsSandboxSource({ name: "Query events", slug }),
			});
			const { jobId } = yield* enqueueSandboxScript(userId, {
				scriptId,
				context: { entityId, entitySchemaSlug, eventSchemaSlug },
			});

			const result = yield* pollSandboxResult(userId, jobId);
			assertCompleted(result, "query events sandbox job");
			expect(result.error).toBeNull();
			expect(result.value).toMatchObject([
				{ entityId, eventSchemaSlug, properties: { rating: 5 } },
			]);
		}),
	);

	it.live("runs a pinned system script through executeRyotql", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const suffix = crypto.randomUUID();
			const pluginSlug = `e2e-ryotql-system-${suffix}`;
			const providerSlug = `e2e-ryotql-system-provider-${suffix}`;
			const providerScriptSlug = `${providerSlug}.details`;
			const entitySchemaSlug = `e2e-ryotql-system-entity-${suffix}`;
			const scriptSlug = `e2e-ryotql-system-script-${suffix}`;
			const cronSlug = `e2e-ryotql-system-cron-${suffix}`;
			const entry = "scripts/ryotql-system.sandbox.ts";
			const providerEntry = "scripts/provider-details.sandbox.ts";
			const entity = table("entity", "entity");
			const query = document({
				entities: rows(entity, {
					limit: 100,
					fields: [
						field("id", column(entity, "id")),
						field("name", column(entity, "name")),
						field("properties", column(entity, "properties")),
					],
					where: eq(column(entity, "entitySchemaSlug"), literal(entitySchemaSlug)),
				}),
			});
			const backend = getBackendClient();
			let globalEntityIds: EntityId[] = [];
			const installed = yield* Effect.acquireRelease(
				installTestPluginBundle({
					pluginSlug,
					files: {
						[providerEntry]: providerSandboxSource({
							name: "RyotQL system provider details",
							slug: providerScriptSlug,
							operation: "details",
							result: fakeProviderDetailsResult({ name: "RyotQL system provider" }),
						}),
						[entry]: systemRyotqlProbeSandboxSource({
							name: "RyotQL system probe",
							slug: scriptSlug,
							entitySchemaSlug,
							query,
							queryName: "entities",
						}),
					},
					scripts: [
						{
							providerSlug,
							kind: "provider",
							name: "RyotQL system provider details",
							slug: providerScriptSlug,
							entry: providerEntry,
							providerOperation: "details",
							capabilities: [],
							requiredPluginConfigKeys: [],
							requiredSystemConfigKeys: [],
						},
						{
							providerSlug,
							kind: "script",
							name: "RyotQL system probe",
							slug: scriptSlug,
							entry,
							capabilities: ["executeRyotql", "upsertGlobalEntities"],
							requiredPluginConfigKeys: [],
							requiredSystemConfigKeys: [],
						},
					],
					providers: [
						{
							slug: providerSlug,
							name: "RyotQL system provider",
							information: { source: "e2e" },
							operations: { details: providerScriptSlug },
						},
					],
					crons: [
						{
							slug: cronSlug,
							scriptSlug,
							schedule: { cron: "0 0 * * *" },
							description: "Run the RyotQL system probe",
						},
					],
					entitySchemas: [
						{
							slug: entitySchemaSlug,
							name: "RyotQL system entity",
							icon: "box",
							accentColor: "#64748b",
							propertiesSchema: { unknownKeys: "strict", fields: {} },
							eventSchemas: [],
						},
					],
				}),
				(plugin) =>
					Effect.gen(function* () {
						if (globalEntityIds.length > 0) {
							yield* backend
								.call(
									(c) => c.testSupport.deleteGlobalEntities({ payload: { ids: globalEntityIds } }),
									adminHeaders,
								)
								.pipe(Effect.ignore);
						}
						yield* backend
							.call(
								(c) => c.godMode.deleteUser({ params: { userId: UserId.make(userId) } }),
								adminHeaders,
							)
							.pipe(Effect.ignore);
						yield* uninstallTestPlugin(plugin).pipe(Effect.ignore);
					}),
			);
			const globalEntity = yield* backend.call(
				(c) =>
					c.testSupport.createGlobalEntity({
						payload: {
							name: "Owned global entity",
							properties: {},
							externalId: `owned-global-${suffix}`,
							entitySchemaSlug: EntitySchemaSlug.make(entitySchemaSlug),
						},
					}),
				adminHeaders,
			);
			globalEntityIds = [globalEntity.id];
			yield* createEntity(client, {
				name: "User entity",
				properties: {},
				entitySchemaSlug: EntitySchemaSlug.make(entitySchemaSlug),
			});

			const trigger = yield* backend.call(
				(c) =>
					c.testSupport.triggerPluginCron({
						payload: { pluginSlug: PluginSlug.make(installed.pluginSlug), cronSlug },
					}),
				adminHeaders,
			);
			expect(trigger.status).toBe("executed");

			const response = yield* pollUntil(
				"system RyotQL probe",
				executeRyotQL(client, query).pipe(
					Effect.map((result) => {
						const entityRowsResult = result.data.entities;
						if (entityRowsResult?.type !== "rows") {
							return null;
						}
						return entityRowsResult.items.some(
							(row) => requireRyotQLTextField(row, "name") === "RyotQL system probe",
						)
							? result
							: null;
					}),
				),
			);
			const entityRowsResult = response.data.entities;
			if (entityRowsResult?.type !== "rows") {
				throw new Error("Expected system RyotQL rows");
			}
			const marker = requirePresent(
				entityRowsResult.items.find(
					(row) => requireRyotQLTextField(row, "name") === "RyotQL system probe",
				),
				"Expected system RyotQL marker",
			);
			globalEntityIds.push(EntityId.make(requireRyotQLTextField(marker, "id")));
			const properties = requireRyotQLFieldValue(marker, "properties");
			expect(properties.kind).toBe("json");
			if (properties.kind === "json") {
				expect(properties.value).toEqual({ rowCount: 1 });
			}
		}),
	);
});
