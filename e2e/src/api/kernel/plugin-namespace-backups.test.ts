import { mapPluginIdentityReferences } from "@ryot-app/contract/modules/ryotql/language";
import {
	EntitySchemaSlug,
	pluginPackageSegments,
	SignalSchemaSlug,
} from "@ryot-app/contract/schema/brands";
import {
	ascending,
	column,
	document,
	eq,
	field,
	literal,
	pluginId,
	rows,
	table,
} from "@ryot-app/ryotql";
import { Effect } from "effect";
import getPort from "get-port";

import {
	adminHeaders,
	createAuthenticatedClient,
	createSavedView,
	createEntity,
	createIntegration,
	listIntegrations,
	enqueueProviderEntityImport,
	pollProviderEntityImportResult,
	installNotificationRule,
	namespaceProvidersRecipe,
	namespaceRelationshipsRecipe,
	namespaceEntityGraphRecipe,
	namespaceSubscriptionsRecipe,
	workspaceSavedViewRecordsRecipe,
	listEventsForEntity,
	getSavedView,
	getUserSettings,
	executeRyotQLRecipe,
	executeRyotQLError,
	exportAndDownloadBackup,
	findSavedViewById,
	getApiClient,
	installNamespacePackage,
	installTestSupportSystemPlugin,
	invokeNamespaceOperation,
	listNamespaceInstallations,
	listSavedViews,
	namespaceBottlesRecipe,
	namespaceInstallation,
	pluginNamespacePackages,
	restoreBackup,
} from "~/fixtures/kernel";
import { assertCompleted, assertTaggedError, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import {
	buildApiEnv,
	spawnApiProcess,
	startCoreTestInfrastructure,
	stopApiProcess,
	stopCoreTestInfrastructure,
	waitForHealthCheck,
} from "~/support/provisioning";

describe("plugin namespace backups", () => {
	it.live(
		"round-trips retained quarantine, hidden intent, homes and typed unavailable owners after system removal",
		() =>
			Effect.gen(function* () {
				const source = yield* createAuthenticatedClient();
				const target = yield* createAuthenticatedClient();
				const packages = pluginNamespacePackages();
				const a = yield* installNamespacePackage(source.client, packages.a);
				const queryEntity = table("entity", "quarantinedBackupEntity");
				const query = document({
					bottles: rows(queryEntity, {
						limit: 100,
						orderBy: [ascending(column(queryEntity, "id"))],
						fields: [field("id", column(queryEntity, "id")), field("opaque", literal(a.pluginId))],
						where: eq(
							column(queryEntity, "entitySchemaPluginId"),
							pluginId({ kind: "local", pluginId: a.pluginId }),
						),
					}),
				});
				const created = yield* createSavedView(source.client, {
					dataSources: query,
					workspaceInstallationId: a.id,
					name: "Retained quarantine query",
					renderer: { kind: "kernel", name: "results-table" },
					settings: {
						pageSize: 25,
						entityLink: null,
						rowKeyFields: ["id"],
						sourceName: "bottles",
						columns: [{ label: "Opaque", field: "opaque", displayKind: "text" }],
					},
				});
				yield* source.client.call((contract) =>
					contract.plugins.setHomeView({
						params: { installationId: a.id },
						payload: { savedView: created.reference },
					}),
				);
				yield* source.client.call((contract) =>
					contract.savedViews.update({
						payload: {
							isHidden: true,
							reference: { kind: "plugin", slug: "all-bottles", pluginId: a.pluginId },
						},
					}),
				);
				yield* source.client.call((contract) =>
					contract.plugins.updatePluginState({
						payload: { isHidden: true },
						params: { installationId: a.id },
					}),
				);
				const system = yield* installTestSupportSystemPlugin(packages.claim);
				let removed = false;
				yield* Effect.addFinalizer(() =>
					removed
						? Effect.void
						: getApiClient()
								.call(
									(contract) =>
										contract.testSupport.uninstallSystemPlugin({
											params: { pluginId: system.pluginId, activationId: system.activationId },
										}),
									adminHeaders(),
								)
								.pipe(Effect.ignore),
				);
				expect(yield* namespaceInstallation(source.client, a.pluginId)).toMatchObject({
					isHidden: true,
					isInitialized: true,
					health: "incompatible",
				});
				yield* getApiClient().call(
					(contract) =>
						contract.testSupport.uninstallSystemPlugin({
							params: { pluginId: system.pluginId, activationId: system.activationId },
						}),
					adminHeaders(),
				);
				removed = true;
				const exported = yield* exportAndDownloadBackup(source.client);
				expect((yield* restoreBackup(target.client, exported.bytes)).run.status).toBe("completed");
				const restored = requirePresent(
					(yield* listNamespaceInstallations(target.client)).find(
						({ scope, packageId }) =>
							packageId === packages.a.manifest.metadata.packageId && scope === "user",
					),
					"Restored quarantine missing",
				);
				expect(restored).toMatchObject({
					isHidden: true,
					isInitialized: true,
					health: "incompatible",
					incompatibilityReason: "package-identity-conflict",
				});
				expect(restored.pluginId).not.toBe(a.pluginId);
				const view = requirePresent(
					(yield* listSavedViews(target.client, { includeHidden: true })).find(
						({ name }) => name === "Retained quarantine query",
					),
					"Restored quarantine query missing",
				);
				expect(view.id).not.toBe(created.id);
				const restoredQuery = requirePresent(view.dataSources, "Retained query missing");
				expect(restoredQuery).toEqual(
					mapPluginIdentityReferences(query, () => ({
						kind: "local",
						pluginId: restored.pluginId,
					})),
				);
				const unavailable = yield* executeRyotQLError(target.client, restoredQuery);
				assertTaggedError(unavailable, "RyotQLBadRequest");
				expect(unavailable.reason).toEqual({
					issue: "unavailable",
					code: "unresolved-query-owner",
					reference: { kind: "local", pluginId: restored.pluginId },
				});
				expect((yield* exportAndDownloadBackup(target.client)).run.status).toBe("completed");
				yield* target.client.call((contract) =>
					contract.plugins.updatePluginState({
						payload: { isHidden: false },
						params: { installationId: restored.id },
					}),
				);
				expect(yield* namespaceInstallation(target.client, restored.pluginId)).toMatchObject({
					health: "ready",
					isInitialized: true,
					incompatibilityReason: null,
				});
				expect(
					(yield* namespaceInstallation(target.client, restored.pluginId)).homeSavedView,
				).toEqual(view.reference);
				expect(
					(yield* getSavedView(target.client, {
						kind: "plugin",
						slug: "all-bottles",
						pluginId: restored.pluginId,
					})).isHidden,
				).toBe(true);
				expect(
					(yield* executeRyotQLRecipe(
						target.client,
						namespaceBottlesRecipe({ reference: { kind: "local", pluginId: restored.pluginId } }),
					)).map(({ name }) => name),
				).toEqual(["A1 bottle"]);
			}),
	);
	it.live(
		"preflights missing and incompatible system dependencies before account replacement",
		() =>
			Effect.gen(function* () {
				const bucketName = `namespace-backup-${crypto.randomUUID()}`;
				const infrastructure = yield* Effect.acquireRelease(
					startCoreTestInfrastructure({ bucketName }),
					stopCoreTestInfrastructure,
				);
				const port = yield* Effect.promise(() => getPort());
				const origin = `http://127.0.0.1:${port}`;
				const destinationApi = `${origin}/api`;
				const process = yield* Effect.acquireRelease(
					Effect.sync(() =>
						spawnApiProcess(
							buildApiEnv({
								port,
								frontendUrl: origin,
								s3BucketName: bucketName,
								dbUrl: infrastructure.dbUrl,
								redisUrl: infrastructure.redisUrl,
								label: "Namespace backup destination",
								s3Endpoint: infrastructure.s3Endpoint,
							}),
						),
					),
					stopApiProcess,
				);
				yield* waitForHealthCheck(
					`${destinationApi}/system/health`,
					"Namespace backup destination",
					process,
				);
				const source = yield* createAuthenticatedClient();
				const target = yield* createAuthenticatedClient(destinationApi);
				const packages = pluginNamespacePackages();
				const system = yield* installTestSupportSystemPlugin(packages.claim);
				yield* getApiClient().call(
					(contract) => contract.testSupport.reconcilePluginInstallations(),
					adminHeaders(),
				);
				yield* namespaceInstallation(source.client, system.pluginId);
				yield* createEntity(source.client, {
					name: "Required system bottle",
					properties: { strength: "forty" },
					entitySchema: {
						slug: EntitySchemaSlug.make("bottle"),
						owner: { kind: "plugin", pluginId: system.pluginId },
					},
				});
				const trustedArchive = yield* exportAndDownloadBackup(source.client);
				const originalViews = (yield* listSavedViews(target.client)).map(({ id }) => id);
				const profile = yield* getUserSettings(target.client);
				const missing = yield* restoreBackup(target.client, trustedArchive.bytes, destinationApi);
				expect(missing.run).toMatchObject({
					status: "failed",
					failure: {
						code: "required-plugin-unavailable",
						packageId: packages.claim.manifest.metadata.packageId,
					},
				});
				expect((yield* listSavedViews(target.client)).map(({ id }) => id)).toEqual(originalViews);
				expect(yield* getUserSettings(target.client)).toEqual(profile);
				const incompatiblePackage = {
					...packages.b,
					manifest: {
						...packages.b.manifest,
						savedViews: [],
						client: undefined,
						userBootstrap: [],
						metadata: {
							...packages.b.manifest.metadata,
							packageId: packages.claim.manifest.metadata.packageId,
						},
					},
				};
				const destinationSystem = yield* installTestSupportSystemPlugin({
					...incompatiblePackage,
					baseUrl: destinationApi,
				});
				yield* getApiClient(destinationApi).call(
					(contract) => contract.testSupport.reconcilePluginInstallations(),
					adminHeaders(),
				);
				const incompatibleTarget = yield* createAuthenticatedClient(destinationApi);
				const incompatibleViews = (yield* listSavedViews(incompatibleTarget.client)).map(
					({ id }) => id,
				);
				const incompatibleProfile = yield* getUserSettings(incompatibleTarget.client);
				const before = yield* namespaceInstallation(
					incompatibleTarget.client,
					destinationSystem.pluginId,
				);
				const incompatible = yield* restoreBackup(
					incompatibleTarget.client,
					trustedArchive.bytes,
					destinationApi,
				);
				expect(incompatible.run).toMatchObject({
					status: "failed",
					failure: {
						code: "required-plugin-unavailable",
						packageId: packages.claim.manifest.metadata.packageId,
					},
				});
				expect(
					(yield* namespaceInstallation(incompatibleTarget.client, destinationSystem.pluginId))
						.contentHash,
				).toBe(before.contentHash);
				expect((yield* listSavedViews(incompatibleTarget.client)).map(({ id }) => id)).toEqual(
					incompatibleViews,
				);
				expect(yield* getUserSettings(incompatibleTarget.client)).toEqual(incompatibleProfile);
			}),
	);
	it.live(
		"rebinds two same-slug private packages and typed query owners without rewriting literals",
		() =>
			Effect.gen(function* () {
				const source = yield* createAuthenticatedClient();
				const target = yield* createAuthenticatedClient();
				const packages = pluginNamespacePackages();
				const a = yield* installNamespacePackage(source.client, packages.a);
				const b = yield* installNamespacePackage(source.client, packages.b);
				const sourceRoots: string[] = [];
				for (const installed of [a, b]) {
					const provider = requirePresent(
						(yield* executeRyotQLRecipe(
							source.client,
							namespaceProvidersRecipe({ kind: "local", pluginId: installed.pluginId }),
						))[0],
						"Source provider missing",
					);
					const { jobId } = yield* enqueueProviderEntityImport(source.client, {
						providerId: provider.id,
						externalId: packages.externalId,
					});
					const imported = yield* pollProviderEntityImportResult(source.client, jobId);
					assertCompleted(imported, "source provider graph");
					sourceRoots.push(imported.data.id);
					yield* installNotificationRule(source.client, {
						slug: SignalSchemaSlug.make("tasted"),
						owner: { kind: "plugin", pluginId: installed.pluginId },
					});
					yield* invokeNamespaceOperation(source.client, installed.installation.packageId, {
						action: "create-event",
						entityId: imported.data.id,
					});
					yield* createIntegration(source.client, {
						providerSpecifics: {},
						provider: { slug: "import", owner: { kind: "plugin", pluginId: installed.pluginId } },
						name:
							installed.pluginId === a.pluginId
								? "A namespace integration"
								: "B namespace integration",
					});
				}
				const pluginHome = { slug: "all-bottles", pluginId: a.pluginId, kind: "plugin" as const };
				yield* source.client.call((contract) =>
					contract.plugins.setHomeView({
						params: { installationId: a.id },
						payload: { savedView: pluginHome },
					}),
				);
				yield* source.client.call((contract) =>
					contract.savedViews.update({
						payload: {
							isHidden: true,
							reference: { kind: "plugin", slug: "all-bottles", pluginId: b.pluginId },
						},
					}),
				);
				const contributorView = yield* createSavedView(source.client, {
					settings: {},
					workspaceInstallationId: b.id,
					name: "Private B contributor view",
					renderer: { kind: "plugin", exportName: "home", pluginId: b.pluginId },
					dataSources: namespaceBottlesRecipe({
						reference: { kind: "local", pluginId: b.pluginId },
					}).document,
				});
				yield* source.client.call((contract) =>
					contract.plugins.setHomeView({
						params: { installationId: b.id },
						payload: { savedView: { kind: "custom", savedViewId: contributorView.id } },
					}),
				);
				const entity = table("entity", "backupNamespaceEntity");
				const query = document({
					bottles: rows(entity, {
						limit: 100,
						orderBy: [ascending(column(entity, "id"))],
						where: eq(
							column(entity, "entitySchemaPluginId"),
							pluginId({ kind: "local", pluginId: a.pluginId }),
						),
						fields: [
							field("id", column(entity, "id")),
							field("opaque", literal(a.pluginId)),
							field("otherOwner", pluginId({ kind: "local", pluginId: b.pluginId })),
						],
					}),
				});
				const view = yield* createSavedView(source.client, {
					dataSources: query,
					workspaceInstallationId: a.id,
					name: "Namespace portable query",
					renderer: { kind: "kernel", name: "results-table" },
					settings: {
						pageSize: 25,
						entityLink: null,
						rowKeyFields: ["id"],
						sourceName: "bottles",
						columns: [{ label: "Opaque", field: "opaque", displayKind: "text" }],
					},
				});
				const saved = yield* findSavedViewById(source.client, view.id);
				const archive = yield* exportAndDownloadBackup(source.client);
				expect((yield* restoreBackup(target.client, archive.bytes)).run.status).toBe("completed");
				const installations = yield* listNamespaceInstallations(target.client);
				const restoredA = requirePresent(
					installations.find(
						({ packageId }) => packageId === packages.a.manifest.metadata.packageId,
					),
					"Restored A missing",
				);
				const restoredB = requirePresent(
					installations.find(
						({ packageId }) => packageId === packages.b.manifest.metadata.packageId,
					),
					"Restored B missing",
				);
				expect(restoredA.pluginId).not.toBe(a.pluginId);
				expect(restoredB.pluginId).not.toBe(b.pluginId);
				expect(restoredA.id).not.toBe(a.id);
				expect(restoredB.id).not.toBe(b.id);
				expect(restoredA).toMatchObject({ health: "ready", isInitialized: true });
				expect(restoredB).toMatchObject({ health: "ready", isInitialized: true });
				for (const [installation, label, strength] of [
					[restoredA, "A1", "forty"],
					[restoredB, "B1", 40],
				] as const) {
					expect(
						(yield* invokeNamespaceOperation(target.client, installation.packageId)).result,
					).toEqual({ label });
					const bottles = yield* executeRyotQLRecipe(
						target.client,
						namespaceBottlesRecipe({
							reference: { kind: "local", pluginId: installation.pluginId },
						}),
					);
					expect(bottles).toHaveLength(2);
					expect(bottles).toEqual(
						expect.arrayContaining([
							expect.objectContaining({
								owner: installation.pluginId,
								properties: { strength, opaque: packages.externalId },
							}),
						]),
					);
					const reference = { kind: "local" as const, pluginId: installation.pluginId };
					const provider = requirePresent(
						(yield* executeRyotQLRecipe(target.client, namespaceProvidersRecipe(reference)))[0],
						"Restored provider missing",
					);
					const graph = yield* executeRyotQLRecipe(
						target.client,
						namespaceEntityGraphRecipe(reference),
					);
					expect(graph).toHaveLength(5);
					expect(graph.every(({ userId }) => userId === target.userId)).toBe(true);
					const root = requirePresent(
						graph.find(
							({ slug, providerId, externalId }) =>
								providerId === provider.id &&
								externalId === packages.externalId &&
								slug === "bottle",
						),
						"Restored provider root missing",
					);
					expect(sourceRoots).not.toContain(root.id);
					const relationships = yield* executeRyotQLRecipe(
						target.client,
						namespaceRelationshipsRecipe(reference),
					);
					expect(relationships).toHaveLength(2);
					expect(
						relationships.every(
							({ userId, sourceId, targetId }) =>
								sourceId === root.id &&
								userId === target.userId &&
								graph.some(({ id }) => id === targetId),
						),
					).toBe(true);
					expect(
						(yield* listEventsForEntity(target.client, root.id, undefined, 100)).map(
							({ properties }) => properties,
						),
					).toEqual([{ note: `${label} policy` }]);
				}
				expect(yield* executeRyotQLRecipe(target.client, namespaceSubscriptionsRecipe())).toEqual(
					expect.arrayContaining([
						{ isActive: true, pluginId: restoredA.pluginId },
						{ isActive: true, pluginId: restoredB.pluginId },
					]),
				);
				const integrations = yield* listIntegrations(target.client);
				for (const [installed, name, label] of [
					[restoredA, "A namespace integration", "A1"],
					[restoredB, "B namespace integration", "B1"],
				] as const) {
					const integration = requirePresent(
						integrations.find((row) => row.name === name),
						"Restored integration missing",
					);
					expect(integration.provider).toBe("import");
					const result = yield* target.client.call((contract) =>
						contract.plugins.invoke({
							payload: { payload: { integrationId: integration.id } },
							params: {
								...pluginPackageSegments(installed.packageId),
								operationSlug: "inspect-integration",
							},
						}),
					);
					expect(result.result).toEqual({ label, integrationId: integration.id });
				}
				expect(
					(yield* getSavedView(target.client, {
						kind: "plugin",
						slug: "all-bottles",
						pluginId: restoredA.pluginId,
					})).isHidden,
				).toBe(false);
				expect(
					(yield* getSavedView(target.client, {
						kind: "plugin",
						slug: "all-bottles",
						pluginId: restoredB.pluginId,
					})).isHidden,
				).toBe(true);
				const restoredContributorView = requirePresent(
					(yield* listSavedViews(target.client)).find(
						({ name }) => name === "Private B contributor view",
					),
					"Restored contributor view missing",
				);
				expect(restoredContributorView.renderer).toEqual({
					kind: "plugin",
					exportName: "home",
					pluginId: restoredB.pluginId,
				});
				expect(restoredA.homeSavedView).toEqual({
					kind: "plugin",
					slug: "all-bottles",
					pluginId: restoredA.pluginId,
				});
				expect(restoredB.homeSavedView).toEqual({
					kind: "custom",
					savedViewId: restoredContributorView.id,
				});
				const restoredView = requirePresent(
					(yield* listSavedViews(target.client)).find(({ name }) => name === saved.name),
					"Restored view missing",
				);
				expect(restoredView.id).not.toBe(view.id);
				const associations = yield* executeRyotQLRecipe(
					target.client,
					workspaceSavedViewRecordsRecipe(),
				);
				expect(associations).toEqual(
					expect.arrayContaining([
						{ id: restoredView.id, installationId: restoredA.id },
						{ installationId: restoredB.id, id: restoredContributorView.id },
					]),
				);
				const restoredQuery = requirePresent(restoredView.dataSources, "Restored query missing");
				const expected = mapPluginIdentityReferences(query, (reference) =>
					reference.kind === "local"
						? {
								kind: "local",
								pluginId:
									reference.pluginId === a.pluginId ? restoredA.pluginId : restoredB.pluginId,
							}
						: reference,
				);
				expect(restoredQuery).toEqual(expected);
			}),
	);

	it.live(
		"preserves restored private claims as quarantine without replacing the destination system owner",
		() =>
			Effect.gen(function* () {
				const source = yield* createAuthenticatedClient();
				const target = yield* createAuthenticatedClient();
				const packages = pluginNamespacePackages();
				const privateA = yield* installNamespacePackage(source.client, packages.a);
				const archive = yield* exportAndDownloadBackup(source.client);
				const system = yield* installTestSupportSystemPlugin(packages.claim);
				yield* Effect.addFinalizer(() =>
					getApiClient()
						.call(
							(contract) =>
								contract.testSupport.uninstallSystemPlugin({
									params: { pluginId: system.pluginId, activationId: system.activationId },
								}),
							adminHeaders(),
						)
						.pipe(Effect.ignore),
				);
				expect((yield* restoreBackup(target.client, archive.bytes)).run.status).toBe("completed");
				const restored = requirePresent(
					(yield* listNamespaceInstallations(target.client)).find(
						({ scope, packageId }) =>
							packageId === packages.a.manifest.metadata.packageId && scope === "user",
					),
					"Restored private claim missing",
				);
				expect(restored).toMatchObject({
					scope: "user",
					health: "incompatible",
					incompatibilityReason: "package-identity-conflict",
				});
				expect(restored.pluginId).not.toBe(privateA.pluginId);
				expect(restored.pluginId).not.toBe(system.pluginId);
				const denied = yield* Effect.flip(
					invokeNamespaceOperation(target.client, restored.packageId),
				);
				assertTaggedError(denied, "PluginConflictError");
				expect(denied.reason.code).toBe("package-identity-conflict");
				expect((yield* exportAndDownloadBackup(target.client)).run.status).toBe("completed");
				expect((yield* namespaceInstallation(source.client, privateA.pluginId)).health).toBe(
					"incompatible",
				);
			}),
	);
});
