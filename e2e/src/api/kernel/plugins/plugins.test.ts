import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { EntityId, EventSchemaSlug, PluginSlug } from "@ryot-app/contract/schema/brands";
import { entityDefinitionsRecipe } from "@ryot-app/ryotql-recipes/definitions";
import { pluginInstallationsRecipe } from "@ryot-app/ryotql-recipes/plugin-installations";
import { Effect } from "effect";

import type { Client } from "~/fixtures/kernel";
import {
	adminHeaders,
	adminSystemPluginsRecipe,
	collectRyotQLRecipeItems,
	listAdminSandboxScripts,
	listAdminSystemPlugins,
	createAuthenticatedClient,
	enqueueSandboxScript,
	enqueueProviderEntityImport,
	fakeProviderDetailsResult,
	fakeProviderSearchResult,
	getApiClient,
	installPrivatePluginPackage,
	installTestPluginBundle,
	pollProviderEntityImportResult,
	pollUntil,
	providerSandboxSource,
	reinstallTestPluginScript,
	testPluginManifest,
	uninstallTestPlugin,
	waitForEventWithSchema,
	searchProviderEntities,
} from "~/fixtures/kernel";
import {
	assertCompleted,
	assertPresent,
	assertTaggedError,
	requireObjectRecord,
} from "~/support/assertions";
import { assert, describe, expect, it } from "~/support/effect-test";

type PluginScript = PluginManifest["scripts"][number];

const listEntities = (client: Client) =>
	collectRyotQLRecipeItems(client, (after) => entityDefinitionsRecipe({ after, limit: 100 }));

const listPlugins = (client: Client) =>
	collectRyotQLRecipeItems(client, (after) => pluginInstallationsRecipe({ after, limit: 100 }));

describe("plugins", () => {
	it.live("runs a third-party plugin lifecycle without restarting", () =>
		Effect.gen(function* () {
			const suffix = crypto.randomUUID();
			const eventSlug = `observed-${suffix}`;
			const resultEventSlug = `automated-result-${suffix}`;
			const pluginSlug = `e2e-lifecycle-${suffix}`;
			const externalId = `plugin-entity-${crypto.randomUUID()}`;
			const schemaSlug = `e2e-lifecycle-entity-${suffix}`;
			const providerSlug = `e2e-lifecycle-provider-${suffix}`;
			const automationSlug = `automation.e2e-lifecycle-${suffix}`;
			const detailsSlug = `${providerSlug}.details`;
			const searchSlug = `${providerSlug}.search`;
			const detailsEntry = `backend/providers/${providerSlug}/details.sandbox.ts`;
			const searchEntry = `backend/providers/${providerSlug}/search.sandbox.ts`;
			const automationEntry = `backend/automations/${automationSlug}.sandbox.ts`;
			const detailsScript = {
				providerSlug,
				capabilities: [],
				slug: detailsSlug,
				entry: detailsEntry,
				kind: "provider" as const,
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
				providerOperation: "details" as const,
				name: "E2E Lifecycle Provider details",
			} satisfies PluginScript;
			const searchScript = {
				providerSlug,
				capabilities: [],
				slug: searchSlug,
				entry: searchEntry,
				kind: "provider" as const,
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
				providerOperation: "search" as const,
				name: "E2E Lifecycle Provider search",
			} satisfies PluginScript;
			const automationScript = {
				slug: automationSlug,
				entry: automationEntry,
				kind: "automation" as const,
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
				capabilities: ["createEvents"],
				automationType: "automation" as const,
				name: "E2E Lifecycle Event Automation",
				inputProjection: { event: { properties: ["note"], compareProperties: [] } },
			} satisfies PluginScript;
			const initialDetailsSource = providerSandboxSource({
				slug: detailsSlug,
				operation: "details",
				name: detailsScript.name,
				result: fakeProviderDetailsResult({
					name: "Lifecycle Entity",
					properties: { category: "initial" },
				}),
			});
			const initialSearchSource = providerSandboxSource({
				slug: searchSlug,
				operation: "search",
				name: searchScript.name,
				result: fakeProviderSearchResult([{ externalId, title: "Lifecycle Entity" }]),
			});
			const automationSource = `
import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import type { JsonValue } from "@ryot-app/sandbox-sdk/wire";

const isJsonObject = (value: JsonValue): value is Readonly<Record<string, JsonValue>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const manifest = defineManifest({
  kind: "automation",
  automationType: "automation",
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  name: "E2E Lifecycle Event Automation",
  slug: ${JSON.stringify(automationSlug)},
  capabilities: ["createEvents"],
  inputProjection: { event: { properties: ["note"], compareProperties: [] } },
});

export default defineAutomation({
  manifest,
  run: ({ automation }, host) => Effect.gen(function* () {
    const payload = automation.payload;
    if (
      automation.causation.source !== "api" ||
      payload.category !== "change" ||
      payload.resource !== "event" ||
      payload.operation !== "create"
    ) {
      return null;
    }
    const event = payload.after;
    const hookMetadata = automation.hookMetadata;
    if (hookMetadata === undefined || !isJsonObject(hookMetadata)) return null;
    const hookLabel = hookMetadata["label"];
    if (typeof hookLabel !== "string") return null;
    const note = event.properties.note;
    if (typeof note !== "string") return null;
    yield* host.createEvents([{
      entityId: event.entityId,
      eventSchemaSlug: ${JSON.stringify(resultEventSlug)},
      properties: {
        note,
        sourceEventId: event.id,
        runId: automation.runId,
        hookLabel,
        hookSlug: automation.hookSlug,
      },
    }]);
    return null;
  }),
});
`;
			let entityId: string | null = null;
			const provider = yield* Effect.acquireRelease(
				installTestPluginBundle({
					pluginSlug,
					scope: "system",
					scripts: [detailsScript, searchScript, automationScript],
					files: {
						[searchEntry]: initialSearchSource,
						[automationEntry]: automationSource,
						[detailsEntry]: initialDetailsSource,
					},
					providers: [
						{
							slug: providerSlug,
							information: { source: "e2e" },
							name: "E2E Lifecycle Provider",
							rootEntitySchemaSlug: schemaSlug,
							operations: { search: searchSlug, details: detailsSlug },
						},
					],
					hooks: [
						{
							stage: "after",
							delivery: "async",
							slug: automationSlug,
							causationSources: ["api"],
							scriptSlug: automationSlug,
							name: "E2E lifecycle event hook",
							metadata: { label: "lifecycle-hook" },
							targets: [
								{
									resource: "event",
									operation: "create",
									eventSchemaSlug: eventSlug,
									entitySchemaSlug: schemaSlug,
								},
							],
						},
					],
					entitySchemas: [
						{
							icon: "box",
							slug: schemaSlug,
							name: "Lifecycle Entity",
							propertiesSchema: {
								unknownKeys: "strict",
								fields: {
									category: { type: "string", label: "Category", description: "Fixture category" },
								},
							},
							eventSchemas: [
								{
									slug: eventSlug,
									name: "Observed",
									propertiesSchema: {
										unknownKeys: "strict",
										fields: {
											note: { label: "Note", type: "string", description: "Observed note" },
										},
									},
								},
								{
									slug: resultEventSlug,
									name: "Automated Result",
									propertiesSchema: {
										unknownKeys: "strict",
										fields: {
											note: { label: "Note", type: "string", description: "Source note" },
											runId: {
												type: "string",
												label: "Run ID",
												description: "Bound automation run ID",
											},
											hookSlug: {
												type: "string",
												label: "Hook slug",
												description: "Invoked automation hook slug",
											},
											sourceEventId: {
												type: "string",
												label: "Source event ID",
												description: "Triggering event ID",
											},
											hookLabel: {
												type: "string",
												label: "Hook label",
												description: "Inline automation hook metadata",
											},
										},
									},
								},
							],
						},
					],
				}),
				(installed) =>
					Effect.gen(function* () {
						const cleanupEntityId = entityId;
						if (cleanupEntityId) {
							yield* getApiClient()
								.call(
									(c) =>
										c.testSupport.deleteGlobalEntities({
											payload: { ids: [EntityId.make(cleanupEntityId)] },
										}),
									adminHeaders(),
								)
								.pipe(
									Effect.catch((error) =>
										Effect.logWarning("[plugins-e2e] entity cleanup failed (non-fatal)", error),
									),
								);
						}
						yield* uninstallTestPlugin(installed);
					}),
			);
			const { client: installedClient } = yield* createAuthenticatedClient();
			const listed = yield* listAdminSystemPlugins;
			const activePlugin = listed.find(({ slug }) => slug === provider.pluginSlug);
			assertPresent(activePlugin, "Missing hot-installed lifecycle plugin");
			expect(activePlugin).toMatchObject({
				version: "1.0.0",
				name: "E2E Test Plugin",
				slug: provider.pluginSlug,
			});
			expect(activePlugin.activeRevisionId).toBe(provider.activePluginRevisionId);
			const definitions = yield* listEntities(installedClient);
			const lifecycleSchema = definitions.find(({ slug }) => slug === schemaSlug);
			assertPresent(lifecycleSchema, "Missing lifecycle entity schema catalog entry");
			expect(lifecycleSchema.eventSchemas.items.map(({ slug }) => slug).sort()).toEqual(
				[eventSlug, resultEventSlug].sort(),
			);

			const originalDetailsScriptId = provider.scriptIds[detailsSlug];
			const originalSearchScriptId = provider.scriptIds[searchSlug];
			assertPresent(originalDetailsScriptId, "Missing hot-installed provider details script");
			assertPresent(originalSearchScriptId, "Missing hot-installed provider search script");
			const originalScripts = yield* listAdminSandboxScripts(provider.activePluginRevisionId);
			const storedDetailsScript = originalScripts.find(({ id }) => id === originalDetailsScriptId);
			const storedSearchScript = originalScripts.find(({ id }) => id === originalSearchScriptId);
			assertPresent(storedDetailsScript, "Missing stored provider details script");
			assertPresent(storedSearchScript, "Missing stored provider search script");
			assertPresent(storedDetailsScript.providerId, "Missing hot-installed provider ID");
			const providerId = storedDetailsScript.providerId;
			const updatedDetailsSource = providerSandboxSource({
				slug: detailsSlug,
				operation: "details",
				name: detailsScript.name,
				result: fakeProviderDetailsResult({
					name: "Reingested Lifecycle Entity",
					properties: { category: "reingested" },
				}),
			});
			const updatedSearchSource = providerSandboxSource({
				slug: searchSlug,
				operation: "search",
				name: searchScript.name,
				result: fakeProviderSearchResult([{ externalId, title: "Reingested Lifecycle Entity" }]),
			});
			const detailsRevision = yield* reinstallTestPluginScript(
				originalDetailsScriptId,
				updatedDetailsSource,
				detailsScript,
			);
			const reingested = yield* reinstallTestPluginScript(
				originalSearchScriptId,
				updatedSearchSource,
				searchScript,
			);
			const reingestedDetailsScriptId = reingested.scriptIds[detailsSlug];
			const reingestedSearchScriptId = reingested.scriptIds[searchSlug];
			assertPresent(reingestedDetailsScriptId, "Missing reingested provider details script ID");
			assertPresent(reingestedSearchScriptId, "Missing reingested provider search script ID");
			expect(detailsRevision.activePluginRevisionId).not.toBe(provider.activePluginRevisionId);
			expect(reingested.activePluginRevisionId).not.toBe(detailsRevision.activePluginRevisionId);
			const reingestedScripts = yield* listAdminSandboxScripts(reingested.activePluginRevisionId);
			const reingestedDetails = reingestedScripts.find(
				({ id }) => id === reingestedDetailsScriptId,
			);
			const reingestedSearch = reingestedScripts.find(({ id }) => id === reingestedSearchScriptId);
			assertPresent(reingestedDetails, "Missing reingested provider details script");
			assertPresent(reingestedSearch, "Missing reingested provider search script");
			expect(reingestedDetailsScriptId).not.toBe(originalDetailsScriptId);
			expect(reingestedSearchScriptId).not.toBe(originalSearchScriptId);
			expect(reingestedDetails).toMatchObject({
				providerId,
				slug: detailsSlug,
				pluginRevisionId: reingested.activePluginRevisionId,
			});
			expect(reingestedSearch).toMatchObject({
				providerId,
				slug: searchSlug,
				pluginRevisionId: reingested.activePluginRevisionId,
			});
			expect(reingestedDetails.contentHash).not.toBe(storedDetailsScript.contentHash);
			expect(reingestedSearch.contentHash).not.toBe(storedSearchScript.contentHash);

			const { client, userId } = yield* createAuthenticatedClient();
			const search = yield* searchProviderEntities(client, {
				page: 1,
				providerId,
				pageSize: 5,
				query: "hot",
			});
			expect(search.providerId).toBe(providerId);
			expect(search.items).toHaveLength(1);
			const searchItem = search.items[0];
			assertPresent(searchItem, "Missing provider search item");
			expect(searchItem.title).toBe("Reingested Lifecycle Entity");

			const imported = yield* enqueueProviderEntityImport(client, {
				providerId: search.providerId,
				externalId: searchItem.externalId,
			});
			const importResult = yield* pollProviderEntityImportResult(client, imported.jobId);
			assertCompleted(importResult, "hot-installed provider import");
			entityId = importResult.data.id;
			expect(importResult.data.name).toBe("Reingested Lifecycle Entity");
			expect(
				requireObjectRecord(importResult.data.properties, "Missing imported entity properties"),
			).toEqual({ category: "reingested" });

			const eventResult = yield* client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId: importResult.data.id,
							properties: { note: "lifecycle-observed" },
							eventSchemaSlug: EventSchemaSlug.make(eventSlug),
						},
					],
				}),
			);
			expect(eventResult).toMatchObject({ count: 1, failure: null });
			const eventOutcome = eventResult.outcomes[0];
			assert(eventOutcome?.status === "written");
			expect(eventOutcome.index).toBe(0);
			const event = yield* waitForEventWithSchema(client, importResult.data.id, eventSlug);
			expect(event).toMatchObject({
				id: eventOutcome.eventId,
				eventSchemaSlug: eventSlug,
				properties: { note: "lifecycle-observed" },
			});
			const automatedEvent = yield* waitForEventWithSchema(
				client,
				importResult.data.id,
				resultEventSlug,
			);
			expect(automatedEvent).toMatchObject({
				eventSchemaSlug: resultEventSlug,
				properties: {
					hookSlug: automationSlug,
					note: "lifecycle-observed",
					hookLabel: "lifecycle-hook",
					sourceEventId: eventOutcome.eventId,
				},
			});
			const automatedProperties = requireObjectRecord(
				automatedEvent.properties,
				"Missing automation execution properties",
			);
			expect(automatedProperties["runId"]).toEqual(expect.any(String));
			const reingestedPlugin = (yield* listAdminSystemPlugins).find(
				({ slug }) => slug === provider.pluginSlug,
			);
			assertPresent(reingestedPlugin, "Missing reingested lifecycle plugin");
			expect(reingestedPlugin.activeRevisionId).toBe(reingested.activePluginRevisionId);
			expect(reingestedPlugin.sourceHash).not.toBe(activePlugin.sourceHash);

			const refusal = yield* Effect.flip(
				getApiClient().call(
					(c) =>
						c.testSupport.uninstallSystemPlugin({ params: { pluginSlug: provider.pluginSlug } }),
					adminHeaders(),
				),
			);
			assertTaggedError(refusal, "PluginConflictError");
			expect(refusal.reason.code).toBe("entity-referenced");

			const deleted = yield* getApiClient().call(
				(c) =>
					c.testSupport.deleteGlobalEntities({
						payload: { ids: [EntityId.make(importResult.data.id)] },
					}),
				adminHeaders(),
			);
			expect(deleted).toEqual({ deleted: 1 });
			entityId = null;
			const uninstalled = yield* pollUntil(
				`uninstall of '${provider.pluginSlug}' after workflow pin release`,
				getApiClient()
					.call(
						(c) =>
							c.testSupport.uninstallSystemPlugin({ params: { pluginSlug: provider.pluginSlug } }),
						adminHeaders(),
					)
					.pipe(
						Effect.catchTag("PluginConflictError", (error) =>
							error.reason.code === "workflow-referenced"
								? Effect.succeed(null)
								: Effect.fail(error),
						),
					),
			);
			provider.active = false;
			expect(uninstalled).toEqual({ pluginId: reingestedPlugin.id });
			const after = yield* listAdminSystemPlugins;
			expect(after.some(({ slug }) => slug === provider.pluginSlug)).toBe(false);
			expect((yield* listEntities(client)).some(({ slug }) => slug === schemaSlug)).toBe(false);
			const historicalFailure = yield* Effect.flip(
				enqueueSandboxScript(userId, { context: {}, scriptId: reingestedSearchScriptId }),
			);
			assertTaggedError(historicalFailure, "TestSupportNotFound");
			expect(historicalFailure.reason).toEqual({
				code: "resource-not-found",
				diagnostic: "Sandbox script not found",
			});
		}),
	);

	it.live("allows user plugin installation and rejects non-admin system administration", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const pluginSlug = `private-${crypto.randomUUID()}`;
			const manifest = testPluginManifest({ pluginSlug, entitySchemas: [] });
			const listed = yield* listPlugins(client);
			expect(listed.every(({ scope }) => scope === "system")).toBe(true);
			const installed = yield* installPrivatePluginPackage({
				client,
				config: {},
				pluginPackage: { manifest, files: {} },
			});
			const afterInstall = yield* listPlugins(client);
			expect(afterInstall.find(({ slug }) => slug === pluginSlug)).toMatchObject({
				config: {},
				scope: "user",
			});
			const uninstalled = yield* client.call((c) =>
				c.plugins.uninstall({ params: { pluginSlug: PluginSlug.make(pluginSlug) } }),
			);
			expect(uninstalled).toEqual(installed);
			const failures = yield* Effect.all([
				Effect.flip(
					client.call((c) =>
						c.adminRyotql.execute({ payload: adminSystemPluginsRecipe({}).document }),
					),
				),
				Effect.flip(
					client.call((c) =>
						c.testSupport.installSystemPlugin({
							payload: { manifest, files: {}, compiledScripts: [] },
						}),
					),
				),
				Effect.flip(
					client.call((c) =>
						c.testSupport.uninstallSystemPlugin({
							params: { pluginSlug: PluginSlug.make(`unauthorized-${crypto.randomUUID()}`) },
						}),
					),
				),
			]);
			for (const failure of failures) {
				assertTaggedError(failure, "AuthUnauthorized");
			}
		}),
	);
});
