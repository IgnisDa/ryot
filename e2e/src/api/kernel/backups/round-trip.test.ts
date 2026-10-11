import { dataJsonSourceReference } from "@ryot-app/contract/modules/imports/data-json";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import {
	EntitySchemaSlug,
	EventSchemaSlug,
	RelationshipSchemaSlug,
} from "@ryot-app/contract/schema/brands";
import { mediaPlugin } from "@ryot-app/media-plugin";
import { column, document, eq, field, literal, rows, table } from "@ryot-app/ryotql";
import {
	pluginUserSettingsRecipe,
	type PluginUserSettingsPage,
} from "@ryot-app/ryotql-recipes/plugin-user-settings";
import { Effect } from "effect";

import {
	type Client,
	cloneSavedView,
	collectRyotQLRecipeItems,
	createAuthenticatedClient,
	createEntity,
	createIntegration,
	createPluginSavedView,
	createPluginScope,
	createRelationship,
	deleteUserAndWait,
	enqueueProviderEntityImport,
	executeRyotQL,
	exportAndDownloadBackup,
	fakeProviderDetailsResult,
	findBuiltinSavedView,
	findPluginInstallationByPackage,
	findSavedViewById,
	getEntity,
	getEntitySchema,
	getNotificationSubscription,
	getSavedView,
	installFixtureClientPlugin,
	installPrivatePluginPackage,
	installTestPluginBundle,
	listEventSchemas,
	listEventsForEntity,
	listImportedEntityNames,
	listIntegrations,
	listNotificationSubscriptions,
	listRelationshipSchemas,
	listSavedViews,
	literalSandboxSource,
	pollImportRunUntilTerminal,
	pollProviderEntityImportResult,
	providerSandboxSource,
	requireRows,
	requireRyotQLText,
	restoreBackup,
	sendDataWebhook,
	setPluginHomeView,
	setNotificationRuleActive,
	settledPrivateInstallation,
	testPluginManifest,
	uninstallTestPlugin,
	updatePluginState,
	waitForCreateEvents,
	getGlobalEntityByProvenance,
	findEntityIdByName,
	findRelationshipBySchema,
	testPluginEntitySchema,
} from "~/fixtures/kernel";
import { compilePluginPackage } from "~/fixtures/kernel/compiled-package";
import {
	assertCompleted,
	assertPresent,
	assertTaggedError,
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

type PluginUserSettingsRecord = PluginUserSettingsPage["items"][number];

const getPluginUserSettings = (client: Client) =>
	collectRyotQLRecipeItems(client, (after) => pluginUserSettingsRecipe({ after, limit: 100 }));

const requireSettingsForField = (
	settings: ReadonlyArray<PluginUserSettingsRecord>,
	fieldName: string,
) =>
	requirePresent(
		settings.find(({ settingsSchema }) => Object.hasOwn(settingsSchema.fields, fieldName)),
		`Missing plugin user settings field '${fieldName}'`,
	);

describe("backup export and restore round trip", () => {
	it.live("maps plugin and saved-view identities while the source account still exists", () =>
		Effect.gen(function* () {
			const source = yield* createAuthenticatedClient();
			const target = yield* createAuthenticatedClient();
			const fixturePlugin = yield* installFixtureClientPlugin(source.client);
			const pluginId = fixturePlugin.pluginId;
			const mediaInstallation = yield* findPluginInstallationByPackage(source.client, {
				scope: "system",
				packageId: mediaPlugin.metadata.packageId,
			});
			const view = yield* createPluginSavedView(
				source.client,
				{ pluginId, kind: "plugin", exportName: "fixture-home" },
				{},
				{ name: "Coexisting backup view", workspaceInstallationId: fixturePlugin.installationId },
			);
			yield* setPluginHomeView(source.client, mediaInstallation.installationId, view.reference);

			const { bytes } = yield* exportAndDownloadBackup(source.client);
			const restored = yield* restoreBackup(target.client, bytes);
			assertCompleted(restored.run, "coexisting-account backup restore");

			const targetFixturePlugin = yield* findPluginInstallationByPackage(target.client, {
				scope: "user",
				packageId: fixturePlugin.packageId,
			});
			const restoredViewRecord = requirePresent(
				(yield* listSavedViews(target.client, {
					installationId: targetFixturePlugin.installationId,
				})).find(({ name }) => name === "Coexisting backup view"),
				"Restored fixture saved view was not found",
			);
			const restoredView = yield* getSavedView(target.client, restoredViewRecord.reference);
			expect(restoredView.id).not.toBe(view.id);
			assert(restoredView.renderer.kind === "plugin");
			expect(restoredView.renderer.pluginId).not.toBe(pluginId);
			expect(restoredView.renderer.exportName).toBe("fixture-home");
			const targetMediaInstallation = yield* findPluginInstallationByPackage(target.client, {
				scope: "system",
				packageId: mediaPlugin.metadata.packageId,
			});
			expect(targetMediaInstallation.homeSavedView).toEqual(restoredViewRecord.reference);

			expect((yield* getSavedView(source.client, view.reference)).id).toBe(view.id);
		}),
	);

	it.live("restores portable user state into a clean account exactly once", () =>
		Effect.gen(function* () {
			const suffix = crypto.randomUUID();
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
			const entry = "backend/scripts/fixture.sandbox.ts";
			const systemPlugin = yield* Effect.acquireRelease(
				installTestPluginBundle({
					pluginSlug,
					scope: "system",
					scripts: [
						{
							entry,
							kind: "script",
							slug: scriptSlug,
							capabilities: [],
							requiredPluginConfigKeys: [],
							name: "Backup round trip fixture",
						},
					],
					files: {
						"client/page.tsx": "export default function BackupPage() { return null; }",
						[entry]: literalSandboxSource({
							value: true,
							slug: scriptSlug,
							name: "Backup round trip fixture",
						}),
					},
					savedViews: [
						{
							sortOrder: 0,
							settings: {},
							dataSources: null,
							slug: pluginViewSlug,
							icon: "layout-dashboard",
							name: "Backup plugin page",
							renderer: { kind: "plugin", exportName: "backup-page" },
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
			const entitySchema = {
				schemaId: EntitySchemaSlug.make(entitySchemaSlug),
				reference: {
					slug: EntitySchemaSlug.make(entitySchemaSlug),
					owner: { kind: "plugin" as const, pluginId: systemPlugin.pluginId },
				},
			};
			const eventSchema = {
				propertiesSchema: eventPropertiesSchema,
				id: EventSchemaSlug.make(eventSchemaSlug),
			};
			const relationshipSchema = {
				propertiesSchema: relationshipPropertiesSchema,
				id: RelationshipSchemaSlug.make(relationshipSchemaSlug),
				reference: {
					slug: RelationshipSchemaSlug.make(relationshipSchemaSlug),
					owner: { kind: "plugin" as const, pluginId: systemPlugin.pluginId },
				},
			};
			const source = yield* createAuthenticatedClient();
			const target = yield* createAuthenticatedClient();
			const privatePluginName = `backup-settings-${suffix}`;
			const privateSettingKey = `backupPreference${suffix.replaceAll("-", "")}`;
			const privateSettingsSchema: NonNullable<PluginManifest["userSettingsSchema"]> = {
				unknownKeys: "strict",
				fields: {
					[privateSettingKey]: {
						type: "boolean",
						label: "Backup preference",
						description: "Private plugin backup preference",
					},
				},
			};
			const basePrivateSettingsManifest = testPluginManifest({ pluginSlug: privatePluginName });
			const privateSettingsManifest: PluginManifest = {
				...basePrivateSettingsManifest,
				userSettingsSchema: privateSettingsSchema,
				metadata: {
					...basePrivateSettingsManifest.metadata,
					name: "Backup private settings fixture",
				},
			};
			const pluginPackage = yield* compilePluginPackage({
				files: {},
				manifest: privateSettingsManifest,
			});
			const privatePlugin = yield* installPrivatePluginPackage({
				config: {},
				pluginPackage,
				client: source.client,
			});
			yield* settledPrivateInstallation(source.client, privatePlugin.id);
			const sourcePluginSettings = yield* getPluginUserSettings(source.client);
			const mediaSettings = requireSettingsForField(sourcePluginSettings, "allowNsfw");
			yield* source.client.call((c) =>
				c.plugins.saveUserSettings({
					payload: { allowNsfw: true },
					params: { installationId: mediaSettings.id },
				}),
			);
			const privateSettings = requireSettingsForField(sourcePluginSettings, privateSettingKey);
			yield* source.client.call((c) =>
				c.plugins.saveUserSettings({
					payload: { [privateSettingKey]: true },
					params: { installationId: privateSettings.id },
				}),
			);
			const sourcePluginInstallation = yield* findPluginInstallationByPackage(source.client, {
				scope: "system",
				packageId: systemPlugin.manifest.metadata.packageId,
			});
			const pluginOwnedView = requirePresent(
				(yield* listSavedViews(source.client, {
					pluginId: systemPlugin.pluginId,
					installationId: sourcePluginInstallation.installationId,
				})).find(({ slug }) => slug === pluginViewSlug),
				"Plugin-owned backup view is missing",
			);
			const clonedPluginView = yield* cloneSavedView(source.client, pluginOwnedView.reference);
			const clonedPluginViewRecord = yield* findSavedViewById(source.client, clonedPluginView.id);
			const sourceMediaInstallation = yield* findPluginInstallationByPackage(source.client, {
				scope: "system",
				packageId: mediaPlugin.metadata.packageId,
			});
			yield* setPluginHomeView(
				source.client,
				sourceMediaInstallation.installationId,
				clonedPluginViewRecord.reference,
			);
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
				entitySchema: entitySchema.reference,
			});
			const secondEntity = yield* createEntity(source.client, {
				properties: secondProperties,
				name: "Second Portable Entity",
				entitySchema: entitySchema.reference,
			});
			const relationshipProperties = { weight: 7, labels: ["primary", "portable"] };
			yield* createRelationship(source.client, {
				sourceEntityId: firstEntity.id,
				targetEntityId: secondEntity.id,
				properties: relationshipProperties,
				relationshipSchema: relationshipSchema.reference,
			});

			const olderOccurredAt = "2026-02-03T04:05:06.000Z";
			const newerOccurredAt = "2026-02-04T04:05:06.000Z";
			const olderProperties = { sequence: 1, labels: ["older"], context: { note: null } };
			const newerProperties = {
				sequence: 2,
				context: { note: "latest" },
				labels: ["newer", "ordered"],
			};
			const createdEvents = yield* waitForCreateEvents(
				source.client,
				yield* source.client.call((c) =>
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
				),
			);
			expect(createdEvents.failure).toBeNull();
			const olderOutcome = createdEvents.outcomes.find(({ index }) => index === 0);
			const newerOutcome = createdEvents.outcomes.find(({ index }) => index === 1);
			assert(olderOutcome?.status === "written");
			assert(newerOutcome?.status === "written");

			const builtinView = yield* findBuiltinSavedView(source.client, {
				kind: "plugin",
				slug: "all-persons",
				pluginId: sourceMediaInstallation.pluginId,
			});
			const targetMediaInstallation = yield* findPluginInstallationByPackage(target.client, {
				scope: "system",
				packageId: mediaPlugin.metadata.packageId,
			});
			expect(
				(yield* getSavedView(target.client, {
					kind: "plugin",
					slug: builtinView.slug,
					pluginId: targetMediaInstallation.pluginId,
				})).isHidden,
			).toBe(false);
			yield* source.client.call((c) =>
				c.savedViews.update({ payload: { isHidden: true, reference: builtinView.reference } }),
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
			yield* updatePluginState(source.client, sourceMediaInstallation.installationId, {
				sortOrder: 73,
				isHidden: true,
			});
			const exportedMediaInstallation = yield* findPluginInstallationByPackage(source.client, {
				scope: "system",
				packageId: mediaPlugin.metadata.packageId,
			});
			expect(exportedMediaInstallation).toMatchObject({ sortOrder: 73, isHidden: true });

			const { bytes } = yield* exportAndDownloadBackup(source.client);
			yield* deleteUserAndWait(source.userId);
			const restored = yield* restoreBackup(target.client, bytes);
			assertCompleted(restored.run, "backup restore");
			const restoredPluginSettings = yield* getPluginUserSettings(target.client);
			expect(requireSettingsForField(restoredPluginSettings, "allowNsfw").settings).toEqual({
				allowNsfw: true,
			});
			expect(requireSettingsForField(restoredPluginSettings, privateSettingKey).settings).toEqual({
				[privateSettingKey]: true,
			});
			const restoredSystemPlugin = yield* findPluginInstallationByPackage(target.client, {
				scope: "system",
				packageId: systemPlugin.manifest.metadata.packageId,
			});
			const restoredEntitySchemaReference = {
				slug: entitySchema.schemaId,
				owner: { kind: "plugin" as const, pluginId: restoredSystemPlugin.pluginId },
			};

			const restoredMediaLibraryId = yield* getMediaLibraryId(target.client);
			expect(restoredMediaLibraryId).toBe(targetMediaLibraryId);
			expect(restoredMediaLibraryId).not.toBe(sourceMediaLibraryId);
			const findRestored = (name: string) =>
				findEntityIdByName(target.client, { name, entitySchema: restoredEntitySchemaReference });
			const [restoredFirstId, restoredSecondId] = yield* Effect.all([
				findRestored(firstEntity.name),
				findRestored(secondEntity.name),
			]);
			const restoredFirst = yield* getEntity(target.client, restoredFirstId);
			const restoredSecond = yield* getEntity(target.client, restoredSecondId);
			expect(restoredFirst).toMatchObject({
				name: firstEntity.name,
				properties: firstProperties,
				entitySchemaSlug: entitySchema.schemaId,
			});
			expect(restoredSecond).toMatchObject({
				name: secondEntity.name,
				properties: secondProperties,
				entitySchemaSlug: entitySchema.schemaId,
			});
			expect(
				yield* findRelationshipBySchema(target.client, {
					sourceEntityId: restoredFirstId,
					targetEntityId: restoredSecondId,
					owner: restoredEntitySchemaReference.owner,
					relationshipSchemaSlug: relationshipSchema.id,
				}),
			).toEqual({
				sourceEntityId: restoredFirstId,
				targetEntityId: restoredSecondId,
				properties: relationshipProperties,
			});

			const restoredEvents = yield* listEventsForEntity(
				target.client,
				restoredFirstId,
				undefined,
				100,
			);
			expect(restoredEvents).toEqual([
				{
					id: expect.any(String),
					sessionEntityId: undefined,
					occurredAt: newerOccurredAt,
					properties: newerProperties,
					eventSchemaSlug: eventSchema.id,
				},
				{
					id: expect.any(String),
					sessionEntityId: undefined,
					occurredAt: olderOccurredAt,
					properties: olderProperties,
					eventSchemaSlug: eventSchema.id,
				},
			]);

			const restoredEntitySchema = yield* getEntitySchema(
				target.client,
				restoredEntitySchemaReference,
			);
			expect(restoredEntitySchema).toMatchObject({
				slug: entitySchema.schemaId,
				name: "Backup Round Trip Entity",
				propertiesSchema: entityPropertiesSchema,
			});
			const restoredEventSchema = requirePresent(
				(yield* listEventSchemas(target.client, restoredEntitySchemaReference)).find(
					({ slug }) => slug === eventSchema.id,
				),
				"Restored event schema is not installed",
			);
			expect(restoredEventSchema.propertiesSchema).toEqual(eventSchema.propertiesSchema);
			const restoredRelationshipSchema = requirePresent(
				(yield* listRelationshipSchemas(target.client, {
					slugs: [relationshipSchema.id],
					owner: { kind: "plugin", pluginId: restoredSystemPlugin.pluginId },
				}))[0],
				"Restored relationship schema is not installed",
			);
			expect(restoredRelationshipSchema).toMatchObject({
				slug: relationshipSchema.id,
				sourceEntitySchemaSlug: entitySchema.schemaId,
				targetEntitySchemaSlug: entitySchema.schemaId,
				propertiesSchema: relationshipSchema.propertiesSchema,
			});

			const restoredView = yield* getSavedView(target.client, {
				kind: "plugin",
				slug: builtinView.slug,
				pluginId: targetMediaInstallation.pluginId,
			});
			expect(restoredView).toMatchObject({ isHidden: true, slug: builtinView.slug });
			const restoredMediaInstallation = yield* findPluginInstallationByPackage(target.client, {
				scope: "system",
				packageId: mediaPlugin.metadata.packageId,
			});
			const restoredPluginViewReference = requirePresent(
				restoredMediaInstallation.homeSavedView,
				"Restored media home view is missing",
			);
			const restoredPluginView = yield* getSavedView(target.client, restoredPluginViewReference);
			expect(restoredPluginView).toMatchObject({
				settings: {},
				dataSources: null,
				renderer: { kind: "plugin", exportName: "backup-page" },
			});
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
			expect(restoredMediaInstallation).toMatchObject({
				packageId: "ryot/media",
				health: exportedMediaInstallation.health,
				isHidden: exportedMediaInstallation.isHidden,
				sortOrder: exportedMediaInstallation.sortOrder,
				healthReason: exportedMediaInstallation.healthReason,
				isInitialized: exportedMediaInstallation.isInitialized,
				incompatibilityReason: exportedMediaInstallation.incompatibilityReason,
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
			const shelfSchemaSlug = EntitySchemaSlug.make("shelf");
			const onShelfSlug = RelationshipSchemaSlug.make("on-shelf");
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
					relationshipSchemas: [
						{
							name: "On shelf",
							slug: onShelfSlug,
							propertiesSchema: { fields: {} },
							targetEntitySchemaSlug: shelfSchemaSlug,
							sourceEntitySchemaSlug: entitySchemaSlug,
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
							providerOperation: "details" as const,
						},
					],
					entitySchemas: [
						testPluginEntitySchema({ name: "Backup Shelf", slug: shelfSchemaSlug }),
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
			const providerPlugin = yield* installProvider("Archived Provider Entity", archivedProperties);
			const source = yield* createAuthenticatedClient();
			const target = yield* createAuthenticatedClient();
			const updater = yield* createAuthenticatedClient();
			const installedSchema = yield* getEntitySchema(source.client, {
				slug: EntitySchemaSlug.make(entitySchemaSlug),
				owner: { kind: "plugin", pluginId: providerPlugin.pluginId },
			});
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
			const providerOwner = { kind: "plugin" as const, pluginId: providerPlugin.pluginId };
			const shelf = yield* createEntity(source.client, {
				properties: {},
				name: "Backup shelf",
				entitySchema: { owner: providerOwner, slug: shelfSchemaSlug },
			});
			yield* createRelationship(source.client, {
				properties: {},
				targetEntityId: shelf.id,
				sourceEntityId: archivedResult.data.id,
				relationshipSchema: { slug: onShelfSlug, owner: providerOwner },
			});
			const { bytes } = yield* exportAndDownloadBackup(source.client);
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
			const restoredShelfId = yield* findEntityIdByName(target.client, {
				name: shelf.name,
				entitySchema: { owner: providerOwner, slug: shelfSchemaSlug },
			});
			expect(
				yield* findRelationshipBySchema(target.client, {
					owner: providerOwner,
					targetEntityId: restoredShelfId,
					sourceEntityId: globalEntity.id,
					relationshipSchemaSlug: onShelfSlug,
				}),
			).toMatchObject({ sourceEntityId: globalEntity.id, targetEntityId: restoredShelfId });
		}),
	);

	it.live("restores a kernel-owned Data webhook and accepts new submissions", () =>
		Effect.gen(function* () {
			const source = yield* createAuthenticatedClient();
			const target = yield* createAuthenticatedClient();
			yield* createIntegration(source.client, {
				providerSpecifics: {},
				name: "Native backup webhook",
				provider: dataJsonSourceReference,
			});
			const { bytes } = yield* exportAndDownloadBackup(source.client);
			yield* deleteUserAndWait(source.userId);
			const restored = yield* restoreBackup(target.client, bytes);
			assertCompleted(restored.run, "Data webhook restore");
			const integrations = yield* listIntegrations(target.client, { provider: "data-json" });
			expect(integrations).toHaveLength(1);
			const [restoredIntegration] = integrations;
			assertPresent(restoredIntegration, "Restored Data webhook is missing");
			expect(restoredIntegration).toMatchObject({
				pluginId: null,
				isDisabled: false,
				name: "Native backup webhook",
			});
			const name = `Restored data collection ${crypto.randomUUID()}`;
			const runId = yield* sendDataWebhook(
				target.client,
				restoredIntegration,
				{
					events: [],
					relationships: [],
					entities: [
						{
							name,
							kind: "custom",
							properties: {},
							key: "collection",
							entitySchema: {
								owner: { kind: "kernel" },
								slug: EntitySchemaSlug.make("collection"),
							},
						},
					],
				},
				"after-restore",
			);
			const run = yield* pollImportRunUntilTerminal(target.client, runId);
			expect(run).toMatchObject({
				status: "completed",
				summary: [
					{
						unit: "entities",
						recordKind: "entity",
						counts: { created: 1, updated: 0, skipped: 0, unchanged: 0, unsuccessful: 0 },
					},
				],
			});
			expect(yield* listImportedEntityNames(target.client, "collection")).toContain(name);
		}),
	);
});
