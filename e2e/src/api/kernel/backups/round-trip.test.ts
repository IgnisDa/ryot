import {
	EntitySchemaSlug,
	EventSchemaSlug,
	PluginSlug,
	RelationshipSchemaSlug,
} from "@ryot-app/contract/schema/brands";
import { column, document, eq, field, literal, rows, table } from "@ryot-app/ryotql";
import { Effect, Option } from "effect";

import {
	type Client,
	cloneSavedView,
	createAuthenticatedClient,
	buildClientRendererDefinition,
	createClientRenderer,
	createEntity,
	createPluginScope,
	createRendererSavedView,
	createRelationship,
	deleteUserAndWait,
	encodeClientRendererSource,
	enqueueProviderEntityImport,
	executeRyotQL,
	exportAndDownloadBackup,
	fakeProviderDetailsResult,
	findBuiltinPluginBySlug,
	findBuiltinSavedView,
	findSavedViewById,
	findPluginInstallationBySlug,
	getClientRenderer,
	getEntity,
	getEntitySchema,
	getNotificationSubscription,
	getSavedView,
	insertRelationshipRow,
	installTestPluginBundle,
	literalSandboxSource,
	listEventSchemas,
	listEventsForEntity,
	listNotificationSubscriptions,
	listRelationshipSchemas,
	listSavedViews,
	pollProviderEntityImportResult,
	providerSandboxSource,
	publishClientRenderer,
	requireRows,
	requireRyotQLText,
	requireRyotQLValue,
	restoreBackup,
	setPluginHomeView,
	setNotificationRuleActive,
	updatePluginState,
	uninstallTestPlugin,
} from "~/fixtures/kernel";
import {
	getGlobalEntityByProvenance,
	queryInMediaLibraryRelationship,
} from "~/fixtures/plugins/media";
import {
	assertCompleted,
	assertTaggedError,
	requireObjectRecord,
	requirePresent,
} from "~/support/assertions";
import { assert, describe, expect, it } from "~/support/effect-test";

const getMediaLibraryId = (client: Client) =>
	Effect.gen(function* () {
		const mediaLibrary = table("entity", "mediaLibrary");
		const result = yield* executeRyotQL(
			client,
			document({
				libraries: rows(mediaLibrary, {
					fields: [field("id", column(mediaLibrary, "id"))],
					where: eq(column(mediaLibrary, "entitySchemaSlug"), literal("media-library")),
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
					where: eq(column(relationship, "id"), literal(relationshipId)),
					fields: [
						field("id", column(relationship, "id")),
						field("properties", column(relationship, "properties")),
						field("sourceEntityId", column(relationship, "sourceEntityId")),
						field("targetEntityId", column(relationship, "targetEntityId")),
						field("relationshipSchemaSlug", column(relationship, "relationshipSchemaSlug")),
					],
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
	it.live("maps renderer and saved-view identities while the source account still exists", () =>
		Effect.gen(function* () {
			const source = yield* createAuthenticatedClient();
			const target = yield* createAuthenticatedClient();
			const rendererDefinition = buildClientRendererDefinition();
			const renderer = yield* createClientRenderer(source.client, {
				name: "Coexisting backup renderer",
				draftDefinition: rendererDefinition,
			});
			yield* publishClientRenderer(
				source.client,
				renderer.id,
				Option.getOrThrow(yield* getClientRenderer(source.client, renderer.id)).draftRevision,
			);
			const view = yield* createRendererSavedView(
				source.client,
				renderer.id,
				{ label: "Coexisting backup view" },
				{ name: "Coexisting backup view" },
			);
			yield* setPluginHomeView(source.client, PluginSlug.make("media"), view.id);

			const { bytes } = yield* exportAndDownloadBackup(source.client, source.token);
			const restored = yield* restoreBackup(target.client, bytes);
			assertCompleted(restored.run, "coexisting-account backup restore");

			const viewRecord = yield* findSavedViewById(source.client, view.id);
			const restoredView = yield* getSavedView(target.client, viewRecord.slug);
			expect(restoredView.id).not.toBe(view.id);
			assert(restoredView.renderer.kind === "custom");
			expect(restoredView.renderer.rendererId).not.toBe(renderer.id);
			expect(
				Option.getOrThrow(yield* getClientRenderer(target.client, restoredView.renderer.rendererId))
					.draftDefinition,
			).toEqual(rendererDefinition);
			expect((yield* findPluginInstallationBySlug(target.client, "media")).homeSavedViewId).toBe(
				restoredView.id,
			);

			expect(Option.getOrThrow(yield* getClientRenderer(source.client, renderer.id)).id).toBe(
				renderer.id,
			);
			expect((yield* getSavedView(source.client, viewRecord.slug)).id).toBe(view.id);
		}),
	);

	it.live("restores portable user state into a clean account exactly once", () =>
		Effect.gen(function* () {
			const suffix = crypto.randomUUID();
			const rendererSource = `export default function BackupDashboard() { return <h1>Backup dashboard ${suffix}</h1>; }`;
			const pluginSlug = createPluginScope(`backup-round-trip-${suffix}`);
			const entitySchemaSlug = `backup-entity-${suffix}`;
			const eventSchemaSlug = `backup-event-${suffix}`;
			const relationshipSchemaSlug = `backup-relationship-${suffix}`;
			const pluginViewSlug = `backup-view-${suffix}`;
			const entityPropertiesSchema = {
				fields: {
					details: {
						label: "Details",
						type: "object" as const,
						description: "Portable nested details",
						properties: {
							note: { label: "Note", type: "string" as const, description: "Optional note" },
							tags: {
								label: "Tags",
								type: "array" as const,
								description: "Ordered tags",
								items: { label: "Tag", description: "Tag", type: "string" as const },
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
			const eventPropertiesSchema = {
				fields: {
					sequence: { label: "Sequence", type: "integer" as const, description: "Event sequence" },
					labels: {
						label: "Labels",
						type: "array" as const,
						description: "Event labels",
						items: { label: "Label", description: "Label", type: "string" as const },
					},
					context: {
						label: "Context",
						type: "object" as const,
						description: "Event context",
						properties: {
							note: { label: "Note", type: "string" as const, description: "Context note" },
						},
					},
				},
			};
			const relationshipPropertiesSchema = {
				fields: {
					weight: { label: "Weight", type: "integer" as const, description: "Relationship weight" },
					labels: {
						label: "Labels",
						type: "array" as const,
						description: "Relationship labels",
						items: { label: "Label", description: "Label", type: "string" as const },
					},
				},
			};
			const scriptSlug = `${pluginSlug}.fixture`;
			const entry = "scripts/fixture.sandbox.ts";
			yield* Effect.acquireRelease(
				installTestPluginBundle({
					pluginSlug,
					scope: "system",
					files: {
						"client/page.tsx": "export default function BackupPage() { return null; }",
						[entry]: literalSandboxSource({
							value: true,
							slug: scriptSlug,
							name: "Backup round trip fixture",
						}),
					},
					scripts: [
						{
							entry,
							kind: "script",
							slug: scriptSlug,
							capabilities: [],
							requiredPluginConfigKeys: [],
							requiredSystemConfigKeys: [],
							name: "Backup round trip fixture",
						},
					],
					relationshipSchemas: [
						{
							slug: relationshipSchemaSlug,
							name: "Backup Round Trip Relationship",
							sourceEntitySchemaSlug: entitySchemaSlug,
							targetEntitySchemaSlug: entitySchemaSlug,
							propertiesSchema: relationshipPropertiesSchema,
						},
					],
					savedViews: [
						{
							pluginSlug,
							sortOrder: 0,
							settings: {},
							dataSources: null,
							slug: pluginViewSlug,
							icon: "layout-dashboard",
							name: "Backup plugin page",
							renderer: { kind: "plugin", exportName: "backup-page" },
						},
					],
					clientDefinition: {
						routes: {},
						entities: {},
						apiVersion: 1,
						homeView: pluginViewSlug,
						exports: {
							"backup-page": {
								kind: "page",
								entry: "client/page.tsx",
								settingsSchema: { fields: {} },
								automaticEntityPresentations: false,
							},
						},
					},
					entitySchemas: [
						{
							icon: "book",
							slug: entitySchemaSlug,
							name: "Backup Round Trip Entity",
							propertiesSchema: entityPropertiesSchema,
							eventSchemas: [
								{
									slug: eventSchemaSlug,
									name: "Backup Round Trip Event",
									propertiesSchema: eventPropertiesSchema,
								},
							],
						},
					],
				}),
				uninstallTestPlugin,
			);
			const entitySchema = { schemaId: EntitySchemaSlug.make(entitySchemaSlug) };
			const eventSchema = {
				propertiesSchema: eventPropertiesSchema,
				id: EventSchemaSlug.make(eventSchemaSlug),
			};
			const relationshipSchema = {
				propertiesSchema: relationshipPropertiesSchema,
				id: RelationshipSchemaSlug.make(relationshipSchemaSlug),
			};
			const source = yield* createAuthenticatedClient();
			const target = yield* createAuthenticatedClient();
			const pluginOwnedView = requirePresent(
				(yield* listSavedViews(source.client, { pluginSlug })).find(
					({ slug }) => slug === pluginViewSlug,
				),
				"Plugin-owned backup view is missing",
			);
			const clonedPluginView = yield* cloneSavedView(source.client, pluginOwnedView.slug);
			const clonedPluginViewRecord = yield* findSavedViewById(source.client, clonedPluginView.id);
			const sourceMediaLibraryId = yield* getMediaLibraryId(source.client);
			const targetMediaLibraryId = yield* getMediaLibraryId(target.client);
			expect(targetMediaLibraryId).not.toBe(sourceMediaLibraryId);

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

			const rendererDefinition = buildClientRendererDefinition({
				files: [{ path: "client/page.tsx", content: encodeClientRendererSource(rendererSource) }],
			});
			const renderer = yield* createClientRenderer(source.client, {
				name: "Backup dashboard renderer",
				draftDefinition: rendererDefinition,
			});
			yield* publishClientRenderer(
				source.client,
				renderer.id,
				Option.getOrThrow(yield* getClientRenderer(source.client, renderer.id)).draftRevision,
			);
			const viewEntity = table("entity", "backupViewEntity");
			const viewDataSources = document({
				entities: rows(viewEntity, {
					fields: [field("id", column(viewEntity, "id"))],
					where: eq(column(viewEntity, "id"), literal(firstEntity.id)),
				}),
			});
			const rendererView = yield* createRendererSavedView(
				source.client,
				renderer.id,
				{ label: "Portable dashboard" },
				{ name: "Backup dashboard", dataSources: viewDataSources },
			);
			const rendererViewRecord = yield* findSavedViewById(source.client, rendererView.id);
			yield* setPluginHomeView(source.client, PluginSlug.make("media"), rendererView.id);

			const builtinView = yield* findBuiltinSavedView(source.client);
			expect((yield* getSavedView(target.client, builtinView.slug)).isDisabled).toBe(false);
			yield* source.client.call((c) =>
				c.savedViews.update({
					params: { viewSlug: builtinView.slug },
					payload: { isDisabled: true, icon: builtinView.icon, name: builtinView.name },
				}),
			);

			const sourceSubscriptions = yield* listNotificationSubscriptions(source.client, {
				limit: 100,
			});
			const notificationSubscription = requirePresent(
				sourceSubscriptions.find(({ signalSchemaSlug }) => signalSchemaSlug === "review.created"),
				"Missing default review notification subscription",
			);
			expect(
				yield* setNotificationRuleActive(source.client, notificationSubscription.id, false),
			).toEqual({ id: notificationSubscription.id });
			expect(
				requirePresent(
					yield* getNotificationSubscription(source.client, notificationSubscription.id),
					"Source notification subscription is missing",
				).isActive,
			).toBe(false);
			yield* updatePluginState(source.client, "media", { sortOrder: 73, isDisabled: true });

			const { bytes } = yield* exportAndDownloadBackup(source.client, source.token);
			yield* deleteUserAndWait(source.userId);
			const restored = yield* restoreBackup(target.client, bytes);
			assertCompleted(restored.run, "backup restore");

			const restoredMediaLibraryId = yield* getMediaLibraryId(target.client);
			expect(restoredMediaLibraryId).toBe(targetMediaLibraryId);
			expect(restoredMediaLibraryId).not.toBe(sourceMediaLibraryId);
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
			expect(restoredView).toMatchObject({ isDisabled: true, slug: builtinView.slug });
			const restoredPluginView = yield* getSavedView(target.client, clonedPluginViewRecord.slug);
			expect(restoredPluginView).toMatchObject({
				settings: {},
				dataSources: null,
				renderer: { kind: "plugin", exportName: "backup-page" },
			});
			const restoredRendererView = yield* getSavedView(target.client, rendererViewRecord.slug);
			expect(restoredRendererView.id).not.toBe(rendererView.id);
			assert(restoredRendererView.renderer.kind === "custom");
			expect(restoredRendererView.renderer.rendererId).not.toBe(renderer.id);
			const restoredRenderer = Option.getOrThrow(
				yield* getClientRenderer(target.client, restoredRendererView.renderer.rendererId),
			);
			expect(restoredRenderer.draftDefinition).toEqual(rendererDefinition);
			expect(restoredRenderer.draftDefinition.files[0]?.content).toBe(
				encodeClientRendererSource(rendererSource),
			);
			expect(restoredRendererView).toMatchObject({
				dataSources: viewDataSources,
				settings: { label: "Portable dashboard" },
				renderer: { kind: "custom", rendererId: restoredRenderer.id },
			});
			expect((yield* findPluginInstallationBySlug(target.client, "media")).homeSavedViewId).toBe(
				restoredRendererView.id,
			);
			const restoredSubscriptions = yield* listNotificationSubscriptions(target.client, {
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
			expect(rejected.reason).toEqual({ category: "events", code: "account-not-clean" });
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
			const detailsEntry = `backend/providers/${providerSlug}/details.sandbox.ts`;
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
					scope: "system",
					files: { [detailsEntry]: scriptSource },
					providers: [
						{
							slug: providerSlug,
							name: "Backup Provider",
							information: { source: "e2e" },
							rootEntitySchemaSlug: entitySchemaSlug,
							operations: { details: detailsScriptSlug },
						},
					],
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
			const sourceMediaLibraryId = yield* getMediaLibraryId(source.client);
			yield* insertRelationshipRow(source.client, {
				targetEntityId: sourceMediaLibraryId,
				sourceEntityId: archivedResult.data.id,
				relationshipSchemaSlug: "in-media-library",
				properties: { owned: true, ownershipSources: ["backup-round-trip"] },
			});
			const { bytes } = yield* exportAndDownloadBackup(source.client, source.token);
			yield* deleteUserAndWait(source.userId);

			const existingBeforeRestore = yield* getEntity(updater.client, archivedResult.data.id);

			const restored = yield* restoreBackup(target.client, bytes);
			assertCompleted(restored.run, "provider natural-identity restore");
			const globalEntity = yield* getGlobalEntityByProvenance(target.client, {
				externalId,
				providerId,
				entitySchemaSlug,
			});
			expect(globalEntity).toMatchObject({
				id: archivedResult.data.id,
				name: existingBeforeRestore.name,
			});
			const existingAfterRestore = yield* getEntity(target.client, globalEntity.id);
			expect(existingAfterRestore.properties).toEqual(existingBeforeRestore.properties);
			const inMediaLibrary = yield* queryInMediaLibraryRelationship(
				target.client,
				globalEntity.id,
				entitySchemaSlug,
			);
			expect(requireRows(inMediaLibrary.data.entity, "entity").items).toHaveLength(1);
		}),
	);
});
