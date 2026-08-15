import { column, document, eq, field, literal, rows, table } from "@ryot/ryotql";
import { Effect } from "effect";

import {
	type Client,
	createAuthenticatedClient,
	createEntity,
	createEntitySchema,
	createEventSchema,
	createPluginScope,
	createRelationship,
	createRelationshipSchema,
	deleteUserAndWait,
	enqueueProviderEntityImport,
	executeRyotQL,
	exportAndDownloadBackup,
	fakeProviderDetailsResult,
	findBuiltinPluginBySlug,
	findBuiltinSavedView,
	getEntity,
	getEntitySchema,
	getGlobalEntityByProvenance,
	getSavedView,
	insertRelationshipRow,
	installTestPluginBundle,
	listEventSchemas,
	listEventsForEntity,
	listNotificationSubscriptionStates,
	listRelationshipSchemas,
	pollProviderEntityImportResult,
	providerSandboxSource,
	queryInLibraryRelationship,
	requireRows,
	requireRyotQLText,
	requireRyotQLValue,
	restoreBackup,
	setNotificationRuleActive,
	updatePluginState,
} from "~/fixtures";
import {
	assertCompleted,
	assertTaggedError,
	requireObjectRecord,
	requirePresent,
} from "~/support/assertions";
import { assert, describe, expect, it } from "~/support/effect-test";

const getLibraryId = (client: Client) =>
	Effect.gen(function* () {
		const library = table("entity", "library");
		const result = yield* executeRyotQL(
			client,
			document({
				libraries: rows(library, {
					fields: [field("id", column(library, "id"))],
					where: eq(column(library, "entitySchemaSlug"), literal("library")),
				}),
			}),
		);
		const libraries = requireRows(result.data.libraries, "libraries");
		expect(libraries.items).toHaveLength(1);
		return requireRyotQLText(requirePresent(libraries.items[0], "Missing library"), "id");
	});

const getRelationship = (client: Client, relationshipId: string) =>
	Effect.gen(function* () {
		const relationship = table("relationship", "relationship");
		const result = yield* executeRyotQL(
			client,
			document({
				relationships: rows(relationship, {
					limit: 1,
					fields: [
						field("id", column(relationship, "id")),
						field("properties", column(relationship, "properties")),
						field("sourceEntityId", column(relationship, "sourceEntityId")),
						field("targetEntityId", column(relationship, "targetEntityId")),
						field("relationshipSchemaSlug", column(relationship, "relationshipSchemaSlug")),
					],
					where: eq(column(relationship, "id"), literal(relationshipId)),
				}),
			}),
		);
		const relationships = requireRows(result.data.relationships, "relationships");
		const row = requirePresent(relationships.items[0], `Missing relationship '${relationshipId}'`);
		return {
			id: requireRyotQLText(row, "id"),
			sourceEntityId: requireRyotQLText(row, "sourceEntityId"),
			targetEntityId: requireRyotQLText(row, "targetEntityId"),
			relationshipSchemaSlug: requireRyotQLText(row, "relationshipSchemaSlug"),
			properties: requireObjectRecord(
				requireRyotQLValue(row, "properties"),
				"Relationship properties must be an object",
			),
		};
	});

describe("backup export and restore round trip", () => {
	it.live("restores portable user state into a clean account exactly once", () =>
		Effect.gen(function* () {
			const setup = yield* createAuthenticatedClient();
			const suffix = crypto.randomUUID();
			const pluginSlug = createPluginScope(`backup-round-trip-${suffix}`);
			const entitySchemaSlug = `backup-entity-${suffix}`;
			const eventSchemaSlug = `backup-event-${suffix}`;
			const relationshipSchemaSlug = `backup-relationship-${suffix}`;
			const entityPropertiesSchema = {
				fields: {
					details: {
						label: "Details",
						type: "object" as const,
						description: "Portable nested details",
						properties: {
							note: { type: "string" as const, label: "Note", description: "Optional note" },
							tags: {
								label: "Tags",
								type: "array" as const,
								description: "Ordered tags",
								items: { type: "string" as const, label: "Tag", description: "Tag" },
							},
							metrics: {
								label: "Metrics",
								type: "object" as const,
								description: "Nested metrics",
								properties: {
									score: { label: "Score", description: "Score", type: "number" as const },
									checkpoints: {
										label: "Checkpoints",
										type: "array" as const,
										description: "Checkpoints",
										items: {
											label: "Checkpoint",
											type: "integer" as const,
											description: "Checkpoint",
										},
									},
								},
							},
						},
					},
				},
			};
			const entitySchema = yield* createEntitySchema(setup.client, {
				pluginSlug,
				slug: entitySchemaSlug,
				name: "Backup Round Trip Entity",
				propertiesSchema: entityPropertiesSchema,
			});
			const eventSchema = yield* createEventSchema(setup.client, {
				entitySchemaSlug: entitySchema.schemaId,
				name: "Backup Round Trip Event",
				slug: eventSchemaSlug,
				propertiesSchema: {
					fields: {
						sequence: { type: "integer", label: "Sequence", description: "Event sequence" },
						labels: {
							type: "array",
							label: "Labels",
							description: "Event labels",
							items: { type: "string", label: "Label", description: "Label" },
						},
						context: {
							type: "object",
							label: "Context",
							description: "Event context",
							properties: { note: { type: "string", label: "Note", description: "Context note" } },
						},
					},
				},
			});
			const relationshipSchema = yield* createRelationshipSchema(setup.client, {
				slug: relationshipSchemaSlug,
				name: "Backup Round Trip Relationship",
				sourceEntitySchemaSlug: entitySchema.schemaId,
				targetEntitySchemaSlug: entitySchema.schemaId,
				propertiesSchema: {
					fields: {
						weight: { type: "integer", label: "Weight", description: "Relationship weight" },
						labels: {
							type: "array",
							label: "Labels",
							description: "Relationship labels",
							items: { type: "string", label: "Label", description: "Label" },
						},
					},
				},
			});
			const source = yield* createAuthenticatedClient();
			const target = yield* createAuthenticatedClient();
			const sourceLibraryId = yield* getLibraryId(source.client);
			const targetLibraryId = yield* getLibraryId(target.client);
			expect(targetLibraryId).not.toBe(sourceLibraryId);

			const firstProperties = {
				details: {
					note: null,
					tags: ["first", "portable"],
					metrics: { score: 9.5, checkpoints: [1, 3, 8] },
				},
			};
			const secondProperties = { details: { tags: [], metrics: null, note: "second" } };
			const firstEntity = yield* createEntity(source.client, {
				properties: firstProperties,
				name: "First Portable Entity",
				entitySchemaSlug: entitySchema.schemaId,
			});
			const secondEntity = yield* createEntity(source.client, {
				properties: secondProperties,
				name: "Second Portable Entity",
				entitySchemaSlug: entitySchema.schemaId,
			});
			const relationshipProperties = { weight: 7, labels: ["primary", "portable"] };
			const relationship = yield* createRelationship(source.client, {
				sourceEntityId: firstEntity.id,
				targetEntityId: secondEntity.id,
				properties: relationshipProperties,
				relationshipSchemaSlug: relationshipSchema.id,
			});

			const olderOccurredAt = "2026-02-03T04:05:06.000Z";
			const newerOccurredAt = "2026-02-04T04:05:06.000Z";
			const olderProperties = { sequence: 1, labels: ["older"], context: { note: null } };
			const newerProperties = {
				sequence: 2,
				context: { note: "latest" },
				labels: ["newer", "ordered"],
			};
			const createdEvents = yield* source.client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId: firstEntity.id,
							occurredAt: olderOccurredAt,
							properties: olderProperties,
							eventSchemaSlug: eventSchema.id,
						},
						{
							entityId: firstEntity.id,
							occurredAt: newerOccurredAt,
							properties: newerProperties,
							eventSchemaSlug: eventSchema.id,
						},
					],
				}),
			);
			expect(createdEvents.failure).toBeNull();
			const olderOutcome = createdEvents.outcomes.find(({ index }) => index === 0);
			const newerOutcome = createdEvents.outcomes.find(({ index }) => index === 1);
			assert(olderOutcome?.status === "written");
			assert(newerOutcome?.status === "written");

			const builtinView = yield* findBuiltinSavedView(source.client);
			expect((yield* getSavedView(target.client, builtinView.slug)).isDisabled).toBe(false);
			yield* source.client.call((c) =>
				c.savedViews.update({
					params: { viewSlug: builtinView.slug },
					payload: {
						isDisabled: true,
						icon: builtinView.icon,
						name: builtinView.name,
						layouts: builtinView.layouts,
						entitySchemaSlug: builtinView.entitySchemaSlug,
						...(builtinView.pluginSlug ? { pluginSlug: builtinView.pluginSlug } : {}),
					},
				}),
			);

			const sourceSubscriptions = yield* listNotificationSubscriptionStates(source.client, {
				limit: 100,
			});
			const notificationSubscription = requirePresent(
				sourceSubscriptions.find(({ signalSchemaSlug }) => signalSchemaSlug === "review.created"),
				"Missing default review notification subscription",
			);
			yield* setNotificationRuleActive(source.client, notificationSubscription.id, false);
			yield* updatePluginState(source.client, "media", { isDisabled: true, sortOrder: 73 });

			const { bytes } = yield* exportAndDownloadBackup(source.client, source.cookies);
			yield* deleteUserAndWait(source.userId);
			const restored = yield* restoreBackup(target.client, bytes);
			assertCompleted(restored.run, "backup restore");

			const restoredLibraryId = yield* getLibraryId(target.client);
			expect(restoredLibraryId).toBe(targetLibraryId);
			expect(restoredLibraryId).not.toBe(sourceLibraryId);
			const restoredFirst = yield* getEntity(target.client, firstEntity.id);
			const restoredSecond = yield* getEntity(target.client, secondEntity.id);
			expect(restoredFirst).toMatchObject({
				id: firstEntity.id,
				name: firstEntity.name,
				properties: firstProperties,
				entitySchemaSlug: entitySchema.schemaId,
			});
			expect(restoredSecond).toMatchObject({
				id: secondEntity.id,
				name: secondEntity.name,
				properties: secondProperties,
				entitySchemaSlug: entitySchema.schemaId,
			});
			expect(yield* getRelationship(target.client, relationship.id)).toEqual({
				id: relationship.id,
				sourceEntityId: firstEntity.id,
				targetEntityId: secondEntity.id,
				properties: relationshipProperties,
				relationshipSchemaSlug: relationshipSchema.id,
			});

			const restoredEvents = yield* listEventsForEntity(
				target.client,
				firstEntity.id,
				undefined,
				100,
			);
			expect(restoredEvents).toEqual([
				{
					id: newerOutcome.eventId,
					sessionEntityId: undefined,
					occurredAt: newerOccurredAt,
					properties: newerProperties,
					eventSchemaSlug: eventSchema.id,
				},
				{
					id: olderOutcome.eventId,
					sessionEntityId: undefined,
					occurredAt: olderOccurredAt,
					properties: olderProperties,
					eventSchemaSlug: eventSchema.id,
				},
			]);

			const restoredEntitySchema = yield* getEntitySchema(target.client, entitySchema.schemaId);
			expect(restoredEntitySchema).toMatchObject({
				slug: entitySchema.schemaId,
				name: "Backup Round Trip Entity",
				propertiesSchema: entityPropertiesSchema,
			});
			const restoredEventSchema = requirePresent(
				(yield* listEventSchemas(target.client, entitySchema.schemaId)).find(
					({ slug }) => slug === eventSchema.id,
				),
				"Restored event schema is not installed",
			);
			expect(restoredEventSchema.propertiesSchema).toEqual(eventSchema.propertiesSchema);
			const restoredRelationshipSchema = requirePresent(
				(yield* listRelationshipSchemas(target.client, { slugs: [relationshipSchema.id] }))[0],
				"Restored relationship schema is not installed",
			);
			expect(restoredRelationshipSchema).toMatchObject({
				slug: relationshipSchema.id,
				sourceEntitySchemaSlug: entitySchema.schemaId,
				targetEntitySchemaSlug: entitySchema.schemaId,
				propertiesSchema: relationshipSchema.propertiesSchema,
			});

			const restoredView = yield* getSavedView(target.client, builtinView.slug);
			expect(restoredView).toMatchObject({ slug: builtinView.slug, isDisabled: true });
			const restoredSubscriptions = yield* listNotificationSubscriptionStates(target.client, {
				limit: 100,
			});
			expect(
				requirePresent(
					restoredSubscriptions.find(
						({ signalSchemaSlug }) =>
							signalSchemaSlug === notificationSubscription.signalSchemaSlug,
					),
					"Restored notification subscription is missing",
				),
			).toMatchObject({
				isActive: false,
				signalSchemaSlug: notificationSubscription.signalSchemaSlug,
			});
			expect(yield* findBuiltinPluginBySlug(target.client, "media")).toMatchObject({
				slug: "media",
				sortOrder: 73,
				isDisabled: true,
			});

			const rejected = yield* Effect.flip(restoreBackup(target.client, bytes));
			assertTaggedError(rejected, "BackupConflict");
			expect(rejected.reason).toEqual({ code: "account-not-clean", category: "events" });
		}),
	);

	it.live("maps an existing global provider entity by portable natural identity", () =>
		Effect.gen(function* () {
			const suffix = crypto.randomUUID();
			const externalId = `backup-provider-entity-${suffix}`;
			const pluginSlug = `backup-provider-plugin-${suffix}`;
			const entitySchemaSlug = `backup-provider-entity-${suffix}`;
			const providerSlug = `${entitySchemaSlug}.provider`;
			const detailsScriptSlug = `${providerSlug}.details`;
			const detailsEntry = `scripts/${detailsScriptSlug}.sandbox.ts`;
			const archivedProperties = { description: "Archived provider state" };
			const installProvider = (name: string, properties: { description: string }) => {
				const scriptSource = providerSandboxSource({
					operation: "details",
					name: `${name} details`,
					slug: detailsScriptSlug,
					result: fakeProviderDetailsResult({ name, properties }),
				});
				return installTestPluginBundle({
					pluginSlug,
					files: { [detailsEntry]: scriptSource },
					scripts: [
						{
							providerSlug,
							capabilities: [],
							entry: detailsEntry,
							name: `${name} details`,
							slug: detailsScriptSlug,
							kind: "provider" as const,
							requiredPluginConfigKeys: [],
							requiredSystemConfigKeys: [],
							providerOperation: "details" as const,
						},
					],
					providers: [
						{
							slug: providerSlug,
							name: "Backup Provider",
							information: { source: "e2e" },
							rootEntitySchemaSlug: entitySchemaSlug,
							operations: { details: detailsScriptSlug },
						},
					],
					entitySchemas: [
						{
							icon: "book",
							eventSchemas: [],
							slug: entitySchemaSlug,
							name: "Backup Provider Entity",
							propertiesSchema: {
								fields: {
									description: {
										label: "Description",
										type: "string" as const,
										description: "Provider state",
									},
								},
							},
						},
					],
				});
			};
			yield* installProvider("Archived Provider Entity", archivedProperties);
			const source = yield* createAuthenticatedClient();
			const target = yield* createAuthenticatedClient();
			const updater = yield* createAuthenticatedClient();
			const installedSchema = yield* getEntitySchema(source.client, entitySchemaSlug);
			const providerId = requirePresent(
				installedSchema.providers[0]?.providerId,
				"Installed backup provider ID is missing",
			);
			const archivedImport = yield* enqueueProviderEntityImport(source.client, {
				externalId,
				providerId,
			});
			const archivedResult = yield* pollProviderEntityImportResult(
				source.client,
				archivedImport.jobId,
			);
			assertCompleted(archivedResult, "archived provider entity import");
			const sourceLibraryId = yield* getLibraryId(source.client);
			yield* insertRelationshipRow(source.client, {
				targetEntityId: sourceLibraryId,
				relationshipSchemaSlug: "in-library",
				sourceEntityId: archivedResult.data.id,
				properties: { owned: true, ownershipSources: ["backup-round-trip"] },
			});
			const { bytes } = yield* exportAndDownloadBackup(source.client, source.cookies);
			yield* deleteUserAndWait(source.userId);

			const existingBeforeRestore = yield* getEntity(updater.client, archivedResult.data.id);

			const restored = yield* restoreBackup(target.client, bytes);
			assertCompleted(restored.run, "provider natural-identity restore");
			const globalEntity = yield* getGlobalEntityByProvenance(target.client, {
				externalId,
				entitySchemaSlug,
				providerId,
			});
			expect(globalEntity).toMatchObject({
				id: archivedResult.data.id,
				name: existingBeforeRestore.name,
			});
			const existingAfterRestore = yield* getEntity(target.client, globalEntity.id);
			expect(existingAfterRestore.properties).toEqual(existingBeforeRestore.properties);
			const inLibrary = yield* queryInLibraryRelationship(
				target.client,
				globalEntity.id,
				entitySchemaSlug,
			);
			expect(requireRows(inLibrary.data.entity, "entity").items).toHaveLength(1);
		}),
	);
});
