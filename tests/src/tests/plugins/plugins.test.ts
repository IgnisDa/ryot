import { EntityId, EntitySchemaSlug, SandboxScriptId } from "@ryot/contract/schema/brands";
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
	getGlobalEntityByProvenance,
	installTestPlugin,
	pollEntityImportResult,
	pollEntitySearchResult,
	providerSandboxSource,
	uninstallTestPlugin,
	uninstallTestPluginStrict,
} from "~/fixtures";
import {
	assertCompleted,
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
				const pluginSlug = `e2e-hot-plugin-${crypto.randomUUID()}`;
				const scriptSlug = `e2e-hot-provider-${crypto.randomUUID()}`;
				const source = providerSandboxSource({
					name: "E2E Hot Provider",
					slug: scriptSlug,
					providerInformation: { source: "e2e" },
					drivers: {
						details: fakeProviderDetailsResult({ name: "Hot Installed Entity" }),
						search: fakeProviderSearchResult([{ externalId, title: "Hot Installed Entity" }]),
					},
				});
				let entityId: string | null = null;
				const plugin = yield* Effect.acquireRelease(
					installTestPlugin({
						source,
						pluginSlug,
						linkToEntitySchemaSlug: schemaSlug,
						entitySchemas: [
							{
								icon: "box",
								slug: schemaSlug,
								eventSchemas: [],
								name: "E2E Hot Entity",
								accentColor: "#64748b",
								propertiesSchema: { fields: {} },
							},
						],
						script: {
							slug: scriptSlug,
							kind: "provider",
							capabilities: [],
							name: "E2E Hot Provider",
							requiredAppConfigKeys: [],
							providerInformation: { source: "e2e" },
						},
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
											Effect.logError("[plugins-e2e] entity cleanup failed (non-fatal)", error),
										),
									);
							}
							yield* uninstallTestPlugin(installed);
						}),
				);
				const { client, userId } = yield* createAuthenticatedClient();
				const listed = yield* getBackendClient().call((c) => c.plugins.list({}), adminHeaders);
				expect(listed.some(({ slug }) => slug === pluginSlug)).toBe(true);

				const search = yield* enqueueEntitySearch(userId, {
					context: { query: "hot", page: 1, pageSize: 5 },
					scriptId: SandboxScriptId.make(plugin.scriptId),
				});
				const searchResult = yield* pollEntitySearchResult(userId, search.jobId);
				assertCompleted(searchResult, "hot-installed provider search");
				const searchValue = requireObjectRecord(
					searchResult.value,
					"Missing provider search result",
				);
				expect(requireArray(searchValue.items, "Missing provider search items")).toHaveLength(1);

				const imported = yield* enqueueEntityImport(client, {
					externalId,
					entitySchemaSlug: EntitySchemaSlug.make(schemaSlug),
					scriptId: SandboxScriptId.make(plugin.scriptId),
				});
				assertCompleted(
					yield* pollEntityImportResult(client, imported.jobId),
					"hot-installed provider import",
				);
				const entity = yield* getGlobalEntityByProvenance(client, {
					externalId,
					entitySchemaSlug: schemaSlug,
					sandboxScriptId: plugin.scriptId,
				});
				entityId = entity.id;
				expect(entity.name).toBe("Hot Installed Entity");

				const refusal = yield* Effect.flip(uninstallTestPluginStrict(plugin));
				assertTaggedError(refusal, "Conflict");

				yield* getBackendClient().call(
					(c) =>
						c.testSupport.deleteGlobalEntities({
							payload: { ids: [EntityId.make(entity.id)] },
						}),
					adminHeaders,
				);
				entityId = null;
				yield* uninstallTestPluginStrict(plugin);
				const after = yield* getBackendClient().call((c) => c.plugins.list({}), adminHeaders);
				expect(after.some(({ slug }) => slug === pluginSlug)).toBe(false);
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
			const scriptSlug = `e2e-uninstalled-provider-${crypto.randomUUID()}`;
			const plugin = yield* installTestPlugin({
				source: providerSandboxSource({
					name: "E2E Uninstalled Provider",
					slug: scriptSlug,
					drivers: { search: fakeProviderSearchResult([]) },
					providerInformation: { source: "e2e" },
				}),
				script: {
					kind: "provider",
					capabilities: [],
					slug: scriptSlug,
					name: "E2E Uninstalled Provider",
					requiredAppConfigKeys: [],
					providerInformation: { source: "e2e" },
				},
			});
			const { userId } = yield* createAuthenticatedClient();
			yield* uninstallTestPluginStrict(plugin);
			const failure = yield* Effect.flip(
				enqueueSandboxScript(userId, {
					context: {},
					driverName: "search",
					scriptId: SandboxScriptId.make(plugin.scriptId),
				}),
			);
			assertTaggedError(failure, "NotFound");
		}),
	);
});
