import type { DataJsonDocument } from "@ryot-app/contract/modules/imports/data-json";
import { dataJsonSource } from "@ryot-app/contract/modules/imports/data-json";
import { ImportRunId } from "@ryot-app/contract/schema/brands";
import { managedAssetItemSchema } from "@ryot-app/contract/schema/core";
import {
	column,
	document as queryDocument,
	eq,
	field,
	literal,
	rows,
	table,
} from "@ryot-app/ryotql";
import { importSourcesRecipe } from "@ryot-app/ryotql-recipes/import-sources";
import { Effect, Encoding, Result } from "effect";

import {
	collectRyotQLRecipeItems,
	createAuthenticatedClient,
	createDataJsonSchemaGraph,
	createEntityFixture,
	createPluginEntitySchema,
	executeRyotQL,
	getEntity,
	getImportRun,
	installTestProvider,
	listEventsForEntity,
	listImportedEntityNames,
	pollImportRunUntilTerminal,
	requireRows,
	requireRyotQLText,
	startDataJsonImport,
	submitDataJsonImport,
	uninstallTestProvider,
} from "~/fixtures/kernel";
import { assertCompleted, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { getApiUrl } from "~/support/harness-target";
import { webRequest } from "~/support/web-request";

const findEntityId = (
	client: Parameters<typeof createEntityFixture>[0],
	schemaSlug: string,
	name: string,
) =>
	Effect.gen(function* () {
		const entity = table("entity", "dataJsonEntity");
		const response = yield* executeRyotQL(
			client,
			queryDocument({
				entities: rows(entity, {
					limit: 100,
					where: eq(column(entity, "entitySchemaSlug"), literal(schemaSlug)),
					fields: [field("id", column(entity, "id")), field("name", column(entity, "name"))],
				}),
			}),
		);
		const row = requirePresent(
			requireRows(response.data.entities, "entities").items.find(
				(item) => requireRyotQLText(item, "name") === name,
			),
			`Expected entity '${name}'`,
		);
		return requireRyotQLText(row, "id");
	});

describe("Native data JSON imports", () => {
	it.live(
		"resolves provider references and does not create custom entities for provider misses",
		() =>
			Effect.gen(function* () {
				const user = yield* createAuthenticatedClient();
				const matchedSlug = `data-matched-${crypto.randomUUID()}`;
				const missingSlug = `data-missing-${crypto.randomUUID()}`;
				const matched = yield* Effect.acquireRelease(
					installTestProvider({
						client: user.client,
						rootEntitySchemaSlug: matchedSlug,
						resolve: { externalId: "matched-native-record" },
						details: { properties: {}, name: "Provider matched record" },
						entitySchemas: [
							{
								icon: "file",
								eventSchemas: [],
								slug: matchedSlug,
								name: "Matched record",
								propertiesSchema: { fields: {} },
							},
						],
					}),
					uninstallTestProvider,
				);
				const missing = yield* Effect.acquireRelease(
					installTestProvider({
						client: user.client,
						resolve: { externalId: null },
						rootEntitySchemaSlug: missingSlug,
						details: { properties: {}, name: "Must not be populated" },
						entitySchemas: [
							{
								icon: "file",
								eventSchemas: [],
								slug: missingSlug,
								name: "Missing record",
								propertiesSchema: { fields: {} },
							},
						],
					}),
					uninstallTestProvider,
				);
				const { run } = yield* startDataJsonImport(user, {
					events: [],
					relationships: [],
					entities: [
						{
							key: "matched",
							kind: "provider",
							value: "foreign-id",
							identifierType: "source-id",
							entitySchemaSlug: matchedSlug,
							providerSlug: matched.providerSlug,
						},
						{
							key: "missing",
							kind: "provider",
							value: "missing-id",
							identifierType: "source-id",
							entitySchemaSlug: missingSlug,
							providerSlug: missing.providerSlug,
						},
					],
				});
				expect(run).toMatchObject({
					failedItems: 1,
					importedItems: 1,
					processedItems: 2,
					status: "completed",
				});
				expect(yield* listImportedEntityNames(user.client, matchedSlug)).toEqual([
					"Provider matched record",
				]);
				expect(yield* listImportedEntityNames(user.client, missingSlug)).toEqual([]);
			}),
	);

	it.live("lists the native source as startable without a plugin", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const sources = yield* collectRyotQLRecipeItems(client, (after) =>
				importSourcesRecipe({ after, limit: 100 }),
			);
			const source = requirePresent(
				sources.find(({ slug }) => slug === dataJsonSource),
				"Expected native data JSON import source",
			);

			expect(source).toMatchObject({ pluginSlug: null, isStartable: true });
		}),
	);

	it.live("orders a mixed-schema graph and resolves direct, session, and nested references", () =>
		Effect.gen(function* () {
			const user = yield* createAuthenticatedClient();
			const graph = yield* createDataJsonSchemaGraph(user.client);
			const alphaName = `Data JSON alpha ${crypto.randomUUID()}`;
			const betaName = `Data JSON beta ${crypto.randomUUID()}`;
			const input: DataJsonDocument = {
				relationships: [
					{
						key: "link",
						properties: {},
						targetEntityKey: "beta",
						sourceEntityKey: "alpha",
						relationshipSchemaSlug: graph.relationship.id,
					},
				],
				events: [
					{
						key: "event",
						entityKey: "alpha",
						sessionEntityKey: "beta",
						eventSchemaSlug: graph.event.id,
						occurredAt: "2026-09-01T00:00:00.000Z",
						properties: { details: { entityReference: "beta", relationshipReference: "link" } },
					},
				],
				entities: [
					{
						key: "alpha",
						kind: "custom",
						name: alphaName,
						properties: { relatedEntity: "beta" },
						entitySchemaSlug: graph.entityA.schemaId,
					},
					{
						key: "beta",
						kind: "custom",
						properties: {},
						name: betaName,
						entitySchemaSlug: graph.entityB.schemaId,
					},
				],
			};

			const { run } = yield* startDataJsonImport(user, input);
			assertCompleted(run, "mixed-schema data JSON import");
			expect(run).toMatchObject({ failedItems: 0, importedItems: 4, processedItems: 4 });
			expect(yield* listImportedEntityNames(user.client, graph.entityA.schemaId)).toEqual([
				alphaName,
			]);
			expect(yield* listImportedEntityNames(user.client, graph.entityB.schemaId)).toEqual([
				betaName,
			]);

			const alphaId = yield* findEntityId(user.client, graph.entityA.schemaId, alphaName);
			const betaId = yield* findEntityId(user.client, graph.entityB.schemaId, betaName);
			const alpha = yield* getEntity(user.client, alphaId);
			expect(alpha.properties.relatedEntity).toBe(betaId);

			const relationship = table("relationship", "dataJsonRelationship");
			const relationshipResponse = yield* executeRyotQL(
				user.client,
				queryDocument({
					relationships: rows(relationship, {
						limit: 10,
						where: eq(
							column(relationship, "relationshipSchemaSlug"),
							literal(graph.relationship.id),
						),
						fields: [
							field("id", column(relationship, "id")),
							field("sourceEntityId", column(relationship, "sourceEntityId")),
							field("targetEntityId", column(relationship, "targetEntityId")),
						],
					}),
				}),
			);
			const relationshipRow = requirePresent(
				requireRows(relationshipResponse.data.relationships, "relationships").items[0],
				"Expected imported relationship",
			);
			const relationshipId = requireRyotQLText(relationshipRow, "id");
			expect(requireRyotQLText(relationshipRow, "sourceEntityId")).toBe(alphaId);
			expect(requireRyotQLText(relationshipRow, "targetEntityId")).toBe(betaId);

			const events = yield* listEventsForEntity(user.client, alphaId, undefined, 100);
			expect(events).toHaveLength(1);
			expect(events[0]?.sessionEntityId).toBe(betaId);
			expect(events[0]?.properties.details).toEqual({
				entityReference: betaId,
				relationshipReference: relationshipId,
			});
		}),
	);

	it.live(
		"blocks a dependent event after invalid entity properties and commits an unrelated entity",
		() =>
			Effect.gen(function* () {
				const user = yield* createAuthenticatedClient();
				const graph = yield* createDataJsonSchemaGraph(user.client);
				const survivorName = `Data JSON survivor ${crypto.randomUUID()}`;
				const { run, runId } = yield* startDataJsonImport(user, {
					relationships: [],
					events: [
						{
							properties: {},
							key: "dependent-event",
							entityKey: "invalid-entity",
							eventSchemaSlug: graph.event.id,
							occurredAt: "2026-09-02T00:00:00.000Z",
						},
					],
					entities: [
						{
							kind: "custom",
							key: "invalid-entity",
							name: "Invalid entity",
							properties: { relatedEntity: 42 },
							entitySchemaSlug: graph.entityA.schemaId,
						},
						{
							kind: "custom",
							properties: {},
							key: "survivor",
							name: survivorName,
							entitySchemaSlug: graph.entityB.schemaId,
						},
					],
				});
				assertCompleted(run, "partially failed data JSON import");
				expect(run).toMatchObject({ failedItems: 2, importedItems: 1, processedItems: 3 });
				const detail = yield* getImportRun(user.client, runId, undefined, 10);
				expect(detail.failures.items).toHaveLength(2);
				expect(detail.failures.items.map(({ sourceIdentifier }) => sourceIdentifier)).toEqual(
					expect.arrayContaining(["invalid-entity", "dependent-event"]),
				);
				expect(yield* listImportedEntityNames(user.client, graph.entityA.schemaId)).toEqual([]);
				expect(yield* listImportedEntityNames(user.client, graph.entityB.schemaId)).toEqual([
					survivorName,
				]);
			}),
	);

	it.live(
		"rejects duplicate keys and unknown nested references without writing invalid records",
		() =>
			Effect.gen(function* () {
				const user = yield* createAuthenticatedClient();
				const graph = yield* createDataJsonSchemaGraph(user.client);
				const duplicate = yield* startDataJsonImport(user, {
					events: [],
					relationships: [],
					entities: [
						{
							kind: "custom",
							properties: {},
							key: "duplicate",
							name: "Duplicate one",
							entitySchemaSlug: graph.entityA.schemaId,
						},
						{
							kind: "custom",
							properties: {},
							key: "duplicate",
							name: "Duplicate two",
							entitySchemaSlug: graph.entityB.schemaId,
						},
					],
				});
				assertCompleted(duplicate.run, "duplicate-key data JSON import");
				expect(duplicate.run).toMatchObject({ failedItems: 2, importedItems: 0 });

				const unknownReference = yield* startDataJsonImport(user, {
					events: [],
					relationships: [],
					entities: [
						{
							kind: "custom",
							key: "unknown-reference",
							name: "Unknown reference",
							entitySchemaSlug: graph.entityA.schemaId,
							properties: { relatedEntity: "missing-entity" },
						},
					],
				});
				assertCompleted(unknownReference.run, "unknown-reference data JSON import");
				expect(unknownReference.run).toMatchObject({ failedItems: 1, importedItems: 0 });
				expect(yield* listImportedEntityNames(user.client, graph.entityA.schemaId)).toEqual([]);
				expect(yield* listImportedEntityNames(user.client, graph.entityB.schemaId)).toEqual([]);
			}),
	);

	it.live("reuses a manual submission key for retries and appends under a separate key", () =>
		Effect.gen(function* () {
			const user = yield* createAuthenticatedClient();
			const schema = yield* createPluginEntitySchema(user.client, {
				schemaName: "Data JSON idempotency",
			});
			const input: DataJsonDocument = {
				events: [],
				relationships: [],
				entities: [
					{
						key: "record",
						kind: "custom",
						properties: {},
						name: "Idempotent record",
						entitySchemaSlug: schema.schemaId,
					},
				],
			};

			const submitted = yield* submitDataJsonImport(user, input, "manual-retry");
			const first = {
				runId: submitted.id,
				run: yield* pollImportRunUntilTerminal(user.client, submitted.id),
			};
			const exactRetry = yield* user.client.call((c) =>
				c.imports.createRun({
					payload: {
						source: dataJsonSource,
						submissionKey: "manual-retry",
						uploadToken: submitted.uploadToken,
					},
				}),
			);
			expect(exactRetry.id).toBe(first.runId);
			const retry = yield* startDataJsonImport(user, input, "manual-retry");
			expect(retry.runId).toBe(first.runId);
			assertCompleted(first.run, "first manual data JSON submission");
			assertCompleted(retry.run, "retried manual data JSON submission");
			expect(yield* listImportedEntityNames(user.client, schema.schemaId)).toEqual([
				"Idempotent record",
			]);

			const separate = yield* startDataJsonImport(user, input, "manual-separate");
			expect(separate.runId).not.toBe(first.runId);
			assertCompleted(separate.run, "separate manual data JSON submission");
			yield* user.client.call((c) =>
				c.imports.deleteRun({ params: { runId: ImportRunId.make(first.runId) } }),
			);
			const afterDeletion = yield* submitDataJsonImport(user, input, "manual-retry");
			expect(afterDeletion.id).toBe(first.runId);
			expect(yield* listImportedEntityNames(user.client, schema.schemaId)).toEqual([
				"Idempotent record",
				"Idempotent record",
			]);
		}),
	);

	it.live("does not change an existing entity and rejects an entity owned by another user", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient();
			const schemaSlug = `data-json-existing-${crypto.randomUUID()}`;
			const ownerSchema = yield* createPluginEntitySchema(owner.client, {
				schemaSlug,
				schemaName: "Data JSON existing owner",
			});
			const ownedEntity = yield* createEntityFixture(owner.client, {
				name: "Existing entity",
				properties: { title: "Preserved" },
				entitySchemaSlug: ownerSchema.schemaId,
			});
			const original = yield* getEntity(owner.client, ownedEntity.id);
			const ownImport = yield* startDataJsonImport(owner, {
				events: [],
				relationships: [],
				entities: [
					{
						key: "existing",
						kind: "existing",
						entityId: ownedEntity.id,
						entitySchemaSlug: ownerSchema.schemaId,
					},
				],
			});
			assertCompleted(ownImport.run, "existing-entity data JSON import");
			expect((yield* getEntity(owner.client, ownedEntity.id)).properties).toEqual(
				original.properties,
			);
			expect(yield* listImportedEntityNames(owner.client, ownerSchema.schemaId)).toEqual([
				"Existing entity",
			]);

			const stranger = yield* createAuthenticatedClient();
			const strangerSchema = yield* createPluginEntitySchema(stranger.client, {
				schemaSlug,
				schemaName: "Data JSON inaccessible entity",
			});
			const foreignImport = yield* startDataJsonImport(stranger, {
				events: [],
				relationships: [],
				entities: [
					{
						key: "foreign",
						kind: "existing",
						entityId: ownedEntity.id,
						entitySchemaSlug: strangerSchema.schemaId,
					},
				],
			});
			assertCompleted(foreignImport.run, "inaccessible-entity data JSON import");
			expect(foreignImport.run).toMatchObject({ failedItems: 1, importedItems: 0 });
			expect(yield* listImportedEntityNames(stranger.client, strangerSchema.schemaId)).toEqual([]);
			expect((yield* getEntity(owner.client, ownedEntity.id)).properties).toEqual(
				original.properties,
			);
		}),
	);

	it.live("imports an owned managed asset locator", () =>
		Effect.gen(function* () {
			const user = yield* createAuthenticatedClient();
			const schema = yield* createPluginEntitySchema(user.client, {
				schemaName: "Data JSON managed asset",
				propertiesSchema: {
					fields: {
						attachment: {
							...managedAssetItemSchema,
							label: "Attachment",
							description: "Managed attachment",
						},
					},
				},
			});
			const content = Result.getOrThrow(
				Encoding.decodeBase64(
					"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7XcAAAAASUVORK5CYII=",
				),
			);
			const intent = yield* user.client.call((c) =>
				c.uploads.createIntent({
					payload: { kind: "permanent", contentType: "image/png", fileName: "data-json.png" },
				}),
			);
			const upload = yield* webRequest(new URL(intent.uploadUrl, `${getApiUrl()}/`), {
				method: intent.method,
				headers: intent.headers,
				body: new Uint8Array(content),
			});
			expect([200, 204]).toContain(upload.status);
			const locator = yield* user.client.call((c) =>
				c.uploads.completeIntent({ params: { intentId: intent.intentId } }),
			);
			if (!("key" in locator)) {
				throw new Error("Expected a permanent managed asset locator");
			}
			const name = `Data JSON asset record ${crypto.randomUUID()}`;
			const { run } = yield* startDataJsonImport(user, {
				events: [],
				relationships: [],
				entities: [
					{
						name,
						kind: "custom",
						key: "asset-record",
						entitySchemaSlug: schema.schemaId,
						properties: { attachment: locator },
					},
				],
			});
			assertCompleted(run, "managed-asset data JSON import");
			expect(run).toMatchObject({ failedItems: 0, importedItems: 1 });
			const entityId = yield* findEntityId(user.client, schema.schemaId, name);
			expect((yield* getEntity(user.client, entityId)).properties.attachment).toEqual(locator);
			const stranger = yield* createAuthenticatedClient();
			const strangerSchema = yield* createPluginEntitySchema(stranger.client, {
				schemaName: "Data JSON foreign asset",
				propertiesSchema: {
					fields: {
						attachment: {
							...managedAssetItemSchema,
							label: "Attachment",
							description: "Managed attachment",
						},
					},
				},
			});
			const foreign = yield* startDataJsonImport(stranger, {
				events: [],
				relationships: [],
				entities: [
					{
						kind: "custom",
						key: "foreign-asset",
						name: "Foreign attachment",
						properties: { attachment: locator },
						entitySchemaSlug: strangerSchema.schemaId,
					},
				],
			});
			expect(foreign.run).toMatchObject({ failedItems: 1, importedItems: 0, status: "completed" });
			expect(yield* listImportedEntityNames(stranger.client, strangerSchema.schemaId)).toEqual([]);
		}),
	);
});
