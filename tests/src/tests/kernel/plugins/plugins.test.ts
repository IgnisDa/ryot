import {
	EntityId,
	EntitySchemaSlug,
	EventSchemaSlug,
	PluginSlug,
} from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	adminHeaders,
	createAuthenticatedClient,
	enqueueSandboxScript,
	enqueueEntityImport,
	enqueueEntitySearch,
	fakeProviderDetailsResult,
	fakeProviderSearchResult,
	getBackendClient,
	installTestPluginBundle,
	pollEntityImportResult,
	pollSandboxResult,
	pollUntil,
	providerSandboxSource,
	reinstallTestPluginScript,
	uninstallTestPlugin,
	waitForEventWithSchema,
} from "~/fixtures";
import {
	assertCompleted,
	assertPresent,
	assertTaggedError,
	requireArray,
	requireObjectRecord,
} from "~/support/assertions";
import { assert, describe, expect, it } from "~/support/effect-test";

describe("plugins", () => {
	it.scopedLive("runs a third-party plugin lifecycle without restarting", () =>
		Effect.gen(function* () {
			const suffix = crypto.randomUUID();
			const eventSlug = `observed-${suffix}`;
			const resultEventSlug = `automated-result-${suffix}`;
			const pluginSlug = `e2e-lifecycle-${suffix}`;
			const externalId = `plugin-entity-${crypto.randomUUID()}`;
			const schemaSlug = `e2e-lifecycle-entity-${suffix}`;
			const providerSlug = `e2e-lifecycle-provider-${suffix}`;
			const automationSlug = `automation.e2e-lifecycle-${suffix}`;
			const eventSchemaSlug = `${schemaSlug}:${eventSlug}`;
			const detailsSlug = `${providerSlug}.details`;
			const searchSlug = `${providerSlug}.search`;
			const detailsEntry = `scripts/${detailsSlug}.sandbox.ts`;
			const searchEntry = `scripts/${searchSlug}.sandbox.ts`;
			const automationEntry = `scripts/${automationSlug}.sandbox.ts`;
			const { client, userId } = yield* createAuthenticatedClient();
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
			};
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
			};
			const automationScript = {
				slug: automationSlug,
				entry: automationEntry,
				kind: "automation" as const,
				capabilities: ["createEvents"],
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
				name: "E2E Lifecycle Event Automation",
			};
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
import { defineAutomation } from "@ryot/sandbox-sdk/automation";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "automation",
  slug: ${JSON.stringify(automationSlug)},
  capabilities: ["createEvents"],
  name: "E2E Lifecycle Event Automation",
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
});

export default defineAutomation({
  manifest,
  run: ({ automation }, host) => {
    const event = automation.source.kind === "event" ? automation.source.after : undefined;
    if (automation.origin.kind !== "api" || !event) return Effect.succeed(null);
    const note = event.properties.note;
    if (typeof note !== "string") return Effect.succeed(null);
    return host.createEvents([{
      entityId: event.subject.id,
      eventSchemaSlug: ${JSON.stringify(resultEventSlug)},
      properties: { sourceEventId: event.id, note },
    }]).pipe(Effect.as(null));
  },
});
`;
			let entityId: string | null = null;
			const provider = yield* Effect.acquireRelease(
				installTestPluginBundle({
					pluginSlug,
					linkToEntitySchemaSlug: schemaSlug,
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
							operations: { details: detailsSlug, search: searchSlug },
						},
					],
					entitySchemas: [
						{
							icon: "box",
							slug: schemaSlug,
							accentColor: "#64748b",
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
											sourceEventId: {
												type: "string",
												label: "Source event ID",
												description: "Triggering event ID",
											},
										},
									},
								},
							],
						},
					],
					eventAutomations: [{ eventSchemaSlug, kind: "subscription", scriptSlug: automationSlug }],
				}),
				(installed) =>
					Effect.gen(function* () {
						const cleanupEntityId = entityId;
						if (cleanupEntityId) {
							yield* getBackendClient()
								.call(
									(c) =>
										c.testSupport.deleteGlobalEntities({
											payload: { ids: [EntityId.make(cleanupEntityId)] },
										}),
									adminHeaders,
								)
								.pipe(
									Effect.catchAll((error) =>
										Effect.logWarning("[plugins-e2e] entity cleanup failed (non-fatal)", error),
									),
								);
						}
						yield* uninstallTestPlugin(installed);
					}),
			);
			const listed = yield* getBackendClient().call((c) => c.plugins.list({}), adminHeaders);
			const activePlugin = listed.find(({ slug }) => slug === provider.pluginSlug);
			assertPresent(activePlugin, "Missing hot-installed lifecycle plugin");
			expect(activePlugin).toMatchObject({
				version: "1.0.0",
				name: "E2E Test Plugin",
				slug: provider.pluginSlug,
			});
			const definitions = yield* client.call((c) => c.definitions.listEntities({}));
			const lifecycleSchema = definitions.find(({ slug }) => slug === schemaSlug);
			assertPresent(lifecycleSchema, "Missing lifecycle entity schema catalog entry");
			expect(lifecycleSchema.eventSchemas.map(({ slug }) => slug).sort()).toEqual(
				[eventSlug, resultEventSlug].sort(),
			);

			const originalDetailsScriptId = provider.scriptIds[detailsSlug];
			const originalSearchScriptId = provider.scriptIds[searchSlug];
			assertPresent(originalDetailsScriptId, "Missing hot-installed provider details script");
			assertPresent(originalSearchScriptId, "Missing hot-installed provider search script");
			const storedDetailsScript = yield* getBackendClient().call(
				(c) => c.testSupport.getSandboxScript({ path: { scriptId: originalDetailsScriptId } }),
				adminHeaders,
			);
			assertPresent(storedDetailsScript.providerId, "Missing hot-installed provider ID");
			const providerId = storedDetailsScript.providerId;
			const updatedDetailsSource = providerSandboxSource({
				operation: "details",
				slug: detailsSlug,
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
			yield* reinstallTestPluginScript(
				originalDetailsScriptId,
				updatedDetailsSource,
				detailsScript,
			);
			yield* reinstallTestPluginScript(originalSearchScriptId, updatedSearchSource, searchScript);
			const reingestedDetailsScriptId = provider.scriptIds[detailsSlug];
			const reingestedSearchScriptId = provider.scriptIds[searchSlug];
			assertPresent(reingestedDetailsScriptId, "Missing reingested provider details script ID");
			assertPresent(reingestedSearchScriptId, "Missing reingested provider search script ID");
			const [reingestedDetails, reingestedSearch] = yield* Effect.all([
				getBackendClient().call(
					(c) => c.testSupport.getSandboxScript({ path: { scriptId: reingestedDetailsScriptId } }),
					adminHeaders,
				),
				getBackendClient().call(
					(c) => c.testSupport.getSandboxScript({ path: { scriptId: reingestedSearchScriptId } }),
					adminHeaders,
				),
			]);
			expect(reingestedDetailsScriptId).not.toBe(originalDetailsScriptId);
			expect(reingestedSearchScriptId).not.toBe(originalSearchScriptId);
			expect(reingestedDetails).toMatchObject({
				providerId,
				slug: detailsSlug,
				source: updatedDetailsSource,
			});
			expect(reingestedSearch).toMatchObject({
				providerId,
				slug: searchSlug,
				source: updatedSearchSource,
			});

			const search = yield* enqueueEntitySearch(userId, {
				scriptId: reingestedSearchScriptId,
				context: { query: "hot", page: 1, pageSize: 5 },
			});
			const searchResult = yield* pollSandboxResult(userId, search.jobId);
			assertCompleted(searchResult, "hot-installed provider search");
			const searchValue = requireObjectRecord(searchResult.value, "Missing provider search result");
			const searchItems = requireArray(searchValue.items, "Missing provider search items");
			expect(searchItems).toHaveLength(1);
			const searchItem = requireObjectRecord(searchItems[0], "Missing provider search item");
			expect(
				requireObjectRecord(searchItem.titleProperty, "Missing provider search title"),
			).toEqual({ kind: "text", value: "Reingested Lifecycle Entity" });

			const imported = yield* enqueueEntityImport(client, {
				externalId,
				providerId,
				entitySchemaSlug: EntitySchemaSlug.make(schemaSlug),
			});
			const importResult = yield* pollEntityImportResult(client, imported.jobId);
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
							eventSchemaSlug: EventSchemaSlug.make(eventSlug),
							entityId: importResult.data.id,
							properties: { note: "lifecycle-observed" },
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
					note: "lifecycle-observed",
					sourceEventId: eventOutcome.eventId,
				},
			});
			const reingestedPlugin = (yield* getBackendClient().call(
				(c) => c.plugins.list({}),
				adminHeaders,
			)).find(({ slug }) => slug === provider.pluginSlug);
			assertPresent(reingestedPlugin, "Missing reingested lifecycle plugin");
			expect(reingestedPlugin.sourceHash).not.toBe(activePlugin.sourceHash);

			const refusal = yield* Effect.flip(
				getBackendClient().call(
					(c) => c.plugins.uninstall({ path: { pluginSlug: provider.pluginSlug } }),
					adminHeaders,
				),
			);
			assertTaggedError(refusal, "Conflict");

			const deleted = yield* getBackendClient().call(
				(c) =>
					c.testSupport.deleteGlobalEntities({
						payload: { ids: [EntityId.make(importResult.data.id)] },
					}),
				adminHeaders,
			);
			expect(deleted).toEqual({ deleted: 1 });
			entityId = null;
			const uninstalled = yield* pollUntil(
				`uninstall of '${provider.pluginSlug}' after workflow pin release`,
				getBackendClient()
					.call(
						(c) => c.plugins.uninstall({ path: { pluginSlug: provider.pluginSlug } }),
						adminHeaders,
					)
					.pipe(Effect.catchTag("Conflict", () => Effect.succeed(null))),
			);
			provider.active = false;
			expect(uninstalled).toEqual(reingestedPlugin);
			const after = yield* getBackendClient().call((c) => c.plugins.list({}), adminHeaders);
			expect(after.some(({ slug }) => slug === provider.pluginSlug)).toBe(false);
			expect(
				(yield* client.call((c) => c.definitions.listEntities({}))).some(
					({ slug }) => slug === schemaSlug,
				),
			).toBe(false);
			const historicalFailure = yield* Effect.flip(
				enqueueSandboxScript(userId, { context: {}, scriptId: reingestedSearchScriptId }),
			);
			assertTaggedError(historicalFailure, "NotFound");
		}),
	);

	it.live("rejects non-admin plugin administration", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const failures = yield* Effect.all([
				Effect.flip(client.call((c) => c.plugins.list({}))),
				Effect.flip(
					client.call((c) => c.plugins.install({ payload: { files: {}, manifest: {} } })),
				),
				Effect.flip(
					client.call((c) =>
						c.plugins.uninstall({
							path: { pluginSlug: PluginSlug.make(`unauthorized-${crypto.randomUUID()}`) },
						}),
					),
				),
			]);
			for (const failure of failures) {
				assertTaggedError(failure, "Unauthorized");
			}
		}),
	);
});
