import { EntityId, EntitySchemaSlug } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	adminHeaders,
	createAuthenticatedClient,
	createEntitySchema,
	enqueueSandboxScript,
	enqueueEntityImport,
	enqueueEntitySearch,
	fakeProviderDetailsResult,
	fakeProviderSearchResult,
	getBackendClient,
	installTestProvider,
	pollEntityImportResult,
	pollEntitySearchResult,
	providerSandboxSource,
	replaceSandboxScriptCompiledRepresentation,
	uninstallTestProvider,
} from "~/fixtures";
import {
	assertCompleted,
	assertPresent,
	assertTaggedError,
	requireArray,
	requireObjectRecord,
} from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("plugins", () => {
	it.scopedLive(
		"hot-installs a provider and refuses uninstall while its schema is referenced",
		() =>
			Effect.gen(function* () {
				const externalId = `plugin-entity-${crypto.randomUUID()}`;
				const schemaSlug = `e2e-hot-entity-${crypto.randomUUID()}`;
				const providerSlug = `e2e-hot-provider-${crypto.randomUUID()}`;
				const { client, userId } = yield* createAuthenticatedClient();
				yield* createEntitySchema(client, {
					slug: schemaSlug,
					name: "E2E Hot Entity",
					pluginSlug: `e2e-hot-schema-${crypto.randomUUID()}`,
				});
				let entityId: string | null = null;
				const provider = yield* Effect.acquireRelease(
					installTestProvider({
						client,
						slug: providerSlug,
						name: "E2E Hot Provider",
						linkToEntitySchemaSlug: schemaSlug,
						details: fakeProviderDetailsResult({ name: "Hot Installed Entity" }),
						search: fakeProviderSearchResult([{ externalId, title: "Hot Installed Entity" }]),
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
							yield* uninstallTestProvider(installed);
						}),
				);
				const listed = yield* getBackendClient().call((c) => c.plugins.list({}), adminHeaders);
				expect(listed.some(({ slug }) => slug === provider.pluginSlug)).toBe(true);

				assertPresent(provider.searchScriptId, "Missing hot-installed provider search script");
				const originalDetailsScriptId = provider.detailsScriptId;
				const originalSearchScriptId = provider.searchScriptId;
				const updatedDetailsSource = providerSandboxSource({
					operation: "details",
					name: "E2E Hot Provider details",
					slug: `${providerSlug}.details`,
					result: fakeProviderDetailsResult({ name: "Reingested Hot Installed Entity" }),
				});
				const updatedSearchSource = providerSandboxSource({
					operation: "search",
					name: "E2E Hot Provider search",
					slug: `${providerSlug}.search`,
					result: fakeProviderSearchResult([
						{ externalId, title: "Reingested Hot Installed Entity" },
					]),
				});
				yield* replaceSandboxScriptCompiledRepresentation(
					client,
					originalDetailsScriptId,
					updatedDetailsSource,
				);
				yield* replaceSandboxScriptCompiledRepresentation(
					client,
					originalSearchScriptId,
					updatedSearchSource,
				);
				const reingestedDetailsScriptId = provider.scriptIds[`${providerSlug}.details`];
				const reingestedSearchScriptId = provider.scriptIds[`${providerSlug}.search`];
				assertPresent(reingestedDetailsScriptId, "Missing reingested provider details script ID");
				assertPresent(reingestedSearchScriptId, "Missing reingested provider search script ID");
				const [reingestedDetails, reingestedSearch] = yield* Effect.all([
					getBackendClient().call(
						(c) =>
							c.testSupport.getSandboxScript({
								path: { scriptId: reingestedDetailsScriptId },
							}),
						adminHeaders,
					),
					getBackendClient().call(
						(c) =>
							c.testSupport.getSandboxScript({
								path: { scriptId: reingestedSearchScriptId },
							}),
						adminHeaders,
					),
				]);
				expect(reingestedDetailsScriptId).not.toBe(originalDetailsScriptId);
				expect(reingestedSearchScriptId).not.toBe(originalSearchScriptId);
				expect(reingestedDetails).toMatchObject({
					providerId: provider.providerId,
					source: updatedDetailsSource,
					slug: `${providerSlug}.details`,
				});
				expect(reingestedSearch).toMatchObject({
					providerId: provider.providerId,
					source: updatedSearchSource,
					slug: `${providerSlug}.search`,
				});

				const search = yield* enqueueEntitySearch(userId, {
					context: { query: "hot", page: 1, pageSize: 5 },
					scriptId: reingestedSearchScriptId,
				});
				const searchResult = yield* pollEntitySearchResult(userId, search.jobId);
				assertCompleted(searchResult, "hot-installed provider search");
				const searchValue = requireObjectRecord(
					searchResult.value,
					"Missing provider search result",
				);
				const searchItems = requireArray(searchValue.items, "Missing provider search items");
				expect(searchItems).toHaveLength(1);
				const searchItem = requireObjectRecord(searchItems[0], "Missing provider search item");
				expect(
					requireObjectRecord(searchItem.titleProperty, "Missing provider search title"),
				).toEqual({ kind: "text", value: "Reingested Hot Installed Entity" });

				const imported = yield* enqueueEntityImport(client, {
					externalId,
					providerId: provider.providerId,
					entitySchemaSlug: EntitySchemaSlug.make(schemaSlug),
				});
				const importResult = yield* pollEntityImportResult(client, imported.jobId);
				assertCompleted(importResult, "hot-installed provider import");
				entityId = importResult.data.id;
				expect(importResult.data.name).toBe("Reingested Hot Installed Entity");

				const refusal = yield* Effect.flip(
					getBackendClient().call(
						(c) => c.plugins.uninstall({ path: { pluginSlug: provider.pluginSlug } }),
						adminHeaders,
					),
				);
				assertTaggedError(refusal, "Conflict");

				yield* getBackendClient().call(
					(c) =>
						c.testSupport.deleteGlobalEntities({
							payload: { ids: [EntityId.make(importResult.data.id)] },
						}),
					adminHeaders,
				);
				entityId = null;
				yield* getBackendClient().call(
					(c) => c.plugins.uninstall({ path: { pluginSlug: provider.pluginSlug } }),
					adminHeaders,
				);
				provider.active = false;
				const after = yield* getBackendClient().call((c) => c.plugins.list({}), adminHeaders);
				expect(after.some(({ slug }) => slug === provider.pluginSlug)).toBe(false);
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
						c.plugins.uninstall({ path: { pluginSlug: `unauthorized-${crypto.randomUUID()}` } }),
					),
				),
			]);
			for (const failure of failures) {
				assertTaggedError(failure, "Unauthorized");
			}
		}),
	);

	it.scopedLive("rejects execution after a plugin is uninstalled", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const provider = yield* installTestProvider({
				client,
				name: "E2E Uninstalled Provider",
				details: fakeProviderDetailsResult({ name: "Uninstalled Entity" }),
				search: fakeProviderSearchResult([]),
			});
			assertPresent(provider.searchScriptId, "Missing provider search script");
			yield* uninstallTestProvider(provider);
			const failure = yield* Effect.flip(
				enqueueSandboxScript(userId, {
					context: {},
					scriptId: provider.searchScriptId,
				}),
			);
			assertTaggedError(failure, "NotFound");
		}),
	);
});
