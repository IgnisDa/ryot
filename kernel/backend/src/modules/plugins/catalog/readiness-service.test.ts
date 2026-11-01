import { assert, expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { KERNEL_ENTITY_IMPORT_WORKFLOW } from "@ryot-app/contract/modules/plugins/execution";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { pluginConfigEnvironmentKey } from "@ryot-app/contract/modules/plugins/plugin-config";
import { UserId } from "@ryot-app/contract/schema/brands";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { and, eq, sql } from "drizzle-orm";
import { ConfigProvider, Effect, Layer } from "effect";

import { OAuthConnectionsRepository } from "#modules/oauth-connections/repository";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { makeConfigProviderLayer } from "#testing/effect";

import { PluginConfigRevisions } from "../configuration/revisions";
import { PluginInstallationRepository } from "../installations/repository";
import { PluginRepository } from "../packages/repository";
import {
	installRevisionPackage,
	oauthRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "../packages/revision.test-support";
import { ImportSourceCatalog } from "./import-sources";
import { IntegrationProviderCatalog } from "./integration-providers";
import { ingestionReadinessMetadataSql } from "./readiness-projection";
import { IngestionReadinessError, IngestionReadinessService } from "./readiness-service";
import { PluginRuntimeResolver } from "./runtime-resolver";

const owner = UserId.make("owner");
const dependencies = Layer.mergeAll(
	ImportSourceCatalog.layer,
	IntegrationProviderCatalog.layer,
	OAuthConnectionsRepository.layer,
).pipe(Layer.provideMerge(revisionDatabaseLayer));
const services = Layer.effect(IngestionReadinessService, IngestionReadinessService.make).pipe(
	Layer.provideMerge(Layer.merge(dependencies, makeConfigProviderLayer())),
);

const configReadinessPackage = (slug: string) => {
	const fixture = revisionPackage(slug);
	const requiredPluginConfigKeys = ["token", "enabled", "threshold", "empty"];
	return {
		...fixture,
		scripts: fixture.scripts.map((script) => ({
			...script,
			metadata: { ...script.metadata, requiredPluginConfigKeys },
		})),
		manifest: {
			...fixture.manifest,
			scripts: fixture.manifest.scripts.map((script) => ({ ...script, requiredPluginConfigKeys })),
			importSources: [
				{
					slug,
					name: "Import",
					description: "Import",
					workflowSlug: `${slug}-flow`,
					inputSchema: { fields: {}, unknownKeys: "strict" as const },
				},
			],
			integrationProviders: [
				{
					slug,
					name: "Integration",
					lot: "sink" as const,
					description: "Integration",
					scriptSlug: `${slug}.task`,
					settingsSchema: { fields: {} },
				},
			],
			configSchema: {
				...fixture.manifest.configSchema,
				fields: {
					...fixture.manifest.configSchema.fields,
					empty: {
						label: "Empty",
						defaultValue: "",
						description: "Empty",
						type: "string" as const,
					},
					enabled: {
						label: "Enabled",
						defaultValue: false,
						description: "Enabled",
						type: "boolean" as const,
					},
					threshold: {
						defaultValue: 0,
						label: "Threshold",
						type: "integer" as const,
						description: "Threshold",
					},
				},
			},
		},
	};
};

layer(services)((test) => {
	for (const scope of ["system", "user"] as const) {
		test.effect(`uses ${scope} key metadata while execution rejects damaged ciphertext`, () =>
			Effect.gen(function* () {
				const slug = `${scope}-config-readiness`;
				const fixture = configReadinessPackage(slug);
				const installed = yield* installRevisionPackage(fixture, scope === "user" ? owner : null);
				const service = yield* IngestionReadinessService;
				const input = {
					settings: {},
					userId: owner,
					sourceSlug: slug,
					providerSlug: slug,
					installationId: installed.installation.id,
				};
				expect((yield* service.evaluateImport(input)).readiness.blockReasons).toEqual([
					{ key: "token", code: "configuration-required" },
				]);
				expect((yield* service.evaluateIntegration(input)).readiness.blockReasons).toEqual([
					{ key: "token", code: "configuration-required" },
				]);
				const configs = yield* PluginConfigRevisions;
				const configId = yield* configs.create({
					pluginRevisionId: installed.revisionId,
					properties: { token: "configured-token" },
					ownerUserId: scope === "user" ? owner : null,
					scope: scope === "user" ? "installation" : "environment",
					pluginInstallationId: scope === "user" ? input.installationId : null,
				});
				const database = yield* DatabaseSession;
				if (scope === "system") {
					yield* (yield* PluginRepository).setEnvironmentConfigRevision(
						installed.pluginId,
						configId,
					);
				} else {
					yield* database.run((db) =>
						db
							.update(tables.pluginInstallation)
							.set({ activeConfigRevisionId: configId })
							.where(eq(tables.pluginInstallation.id, input.installationId)),
					);
				}
				const imported = yield* service.evaluateImport(input);
				const integrated = yield* service.evaluateIntegration(input);
				expect(imported.readiness.ready).toBe(true);
				expect(integrated.readiness.ready).toBe(true);
				expect(imported.source.readinessMetadata.availableConfigKeys).toEqual([
					"empty",
					"enabled",
					"threshold",
					"token",
				]);
				expect(integrated.provider.readinessMetadata).toEqual(imported.source.readinessMetadata);
				expect(imported.pins.pluginConfigRevisionId).toBe(configId);
				expect(integrated.pins.pluginConfigRevisionId).toBe(configId);
				const runtime = yield* PluginRuntimeResolver;
				const readExecutionConfig = runtime.resolvePluginConfigContext({
					id: configId,
					pluginRevisionId: installed.revisionId,
					ownerUserId: scope === "user" ? owner : null,
				});
				expect(yield* readExecutionConfig).toEqual({
					empty: "",
					threshold: 0,
					enabled: false,
					token: "configured-token",
				});
				yield* database.run((db) =>
					db
						.update(tables.pluginConfigRevision)
						.set({ encryptedPayload: Buffer.alloc(32) })
						.where(eq(tables.pluginConfigRevision.id, configId)),
				);
				expect((yield* service.evaluateImport(input)).readiness).toEqual(imported.readiness);
				expect((yield* service.evaluateIntegration(input)).readiness).toEqual(integrated.readiness);
				assertExitFails(
					yield* Effect.exit(readExecutionConfig),
					new DbError({
						message: `Plugin configuration ${configId} is unavailable or failed authentication`,
					}),
				);
				yield* database.run((db) =>
					db
						.update(tables.pluginConfigRevision)
						.set({ encryptedPayload: null, payloadPrunedAt: new Date() })
						.where(eq(tables.pluginConfigRevision.id, configId)),
				);
				assertExitFails(
					yield* Effect.exit(service.evaluateImport(input)),
					new IngestionReadinessError({ message: "Import source operation is unavailable" }),
				);
				assertExitFails(
					yield* Effect.exit(service.evaluateIntegration(input)),
					new IngestionReadinessError({ message: "Integration provider operation is unavailable" }),
				);
			}),
		);
	}
	test.effect(
		"follows revision upgrades and excludes mismatched or foreign configuration pins",
		() =>
			Effect.gen(function* () {
				const slug = "revision-config-readiness";
				const fixture = configReadinessPackage(slug);
				const installed = yield* installRevisionPackage(fixture, owner);
				const installations = yield* PluginInstallationRepository;
				const configured = yield* installations.updateState({
					sortOrder: 0,
					isHidden: false,
					id: installed.installation.id,
					config: { token: "original-token" },
				});
				assert(configured?.activeConfigRevisionId);
				const service = yield* IngestionReadinessService;
				const input = {
					settings: {},
					userId: owner,
					sourceSlug: slug,
					providerSlug: slug,
					installationId: installed.installation.id,
				};
				expect((yield* service.evaluateImport(input)).readiness.ready).toBe(true);
				expect((yield* service.evaluateIntegration(input)).readiness.ready).toBe(true);
				const upgraded = yield* installRevisionPackage(
					{
						...fixture,
						contentHash: `${slug}-upgraded`,
						manifest: {
							...fixture.manifest,
							metadata: { ...fixture.manifest.metadata, version: "upgraded" },
						},
					},
					owner,
				);
				const imported = yield* service.evaluateImport(input);
				const integrated = yield* service.evaluateIntegration(input);
				expect(imported.readiness.blockReasons).toEqual([
					{ key: "token", code: "configuration-required" },
				]);
				expect(integrated.readiness.blockReasons).toEqual(imported.readiness.blockReasons);
				expect(imported.source.readinessMetadata.availableConfigKeys).toEqual([
					"empty",
					"enabled",
					"threshold",
				]);
				expect(integrated.provider.readinessMetadata).toEqual(imported.source.readinessMetadata);
				expect(imported.pins.pluginRevisionId).toBe(upgraded.revisionId);
				expect(imported.pins.pluginRevisionId).not.toBe(installed.revisionId);
				expect(integrated.pins.pluginRevisionId).toBe(upgraded.revisionId);
				expect(imported.pins.pluginConfigRevisionId).not.toBe(configured.activeConfigRevisionId);
				const recipient = UserId.make("recipient");
				const foreign = yield* installRevisionPackage(
					configReadinessPackage("foreign-config-readiness"),
					recipient,
				);
				const foreignConfig = yield* installations.updateState({
					sortOrder: 0,
					isHidden: false,
					id: foreign.installation.id,
					config: { token: "foreign-token" },
				});
				assert(foreignConfig?.activeConfigRevisionId);
				const database = yield* DatabaseSession;
				for (const configId of [
					configured.activeConfigRevisionId,
					foreignConfig.activeConfigRevisionId,
				]) {
					yield* database.run((db) =>
						db
							.update(tables.pluginInstallation)
							.set({ activeConfigRevisionId: configId })
							.where(eq(tables.pluginInstallation.id, installed.installation.id)),
					);
					assertExitFails(
						yield* Effect.exit(service.evaluateImport(input)),
						new IngestionReadinessError({ message: "Import source operation is unavailable" }),
					);
					assertExitFails(
						yield* Effect.exit(service.evaluateIntegration(input)),
						new IngestionReadinessError({
							message: "Integration provider operation is unavailable",
						}),
					);
				}
				assertExitFails(
					yield* Effect.exit(service.evaluateImport({ ...input, userId: recipient })),
					new IngestionReadinessError({ message: "Import source operation is unavailable" }),
				);
				assertExitFails(
					yield* Effect.exit(service.evaluateIntegration({ ...input, userId: recipient })),
					new IngestionReadinessError({ message: "Integration provider operation is unavailable" }),
				);
				yield* database.run((db) =>
					db
						.update(tables.pluginInstallation)
						.set({ activeConfigRevisionId: imported.pins.pluginConfigRevisionId })
						.where(eq(tables.pluginInstallation.id, installed.installation.id)),
				);
				expect((yield* service.evaluateImport(input)).readiness).toEqual(imported.readiness);
				expect((yield* service.evaluateIntegration(input)).readiness).toEqual(integrated.readiness);
			}),
	);
	test.effect(
		"readiness does not load keys while startup and execution reject an unavailable key",
		() =>
			Effect.gen(function* () {
				const slug = "unavailable-config-key";
				const installed = yield* installRevisionPackage(configReadinessPackage(slug), owner);
				const configured = yield* (yield* PluginInstallationRepository).updateState({
					sortOrder: 0,
					isHidden: false,
					id: installed.installation.id,
					config: { token: "configured-token" },
				});
				assert(configured?.activeConfigRevisionId);
				const configId = configured.activeConfigRevisionId;
				const database = yield* DatabaseSession;
				const [stored] = yield* database.run((db) =>
					db
						.select()
						.from(tables.pluginConfigRevision)
						.where(eq(tables.pluginConfigRevision.id, configId)),
				);
				assert(stored);
				yield* database.run((db) =>
					db
						.update(tables.pluginConfigRevision)
						.set({ encryptionKeyId: "unavailable-key" })
						.where(eq(tables.pluginConfigRevision.id, configId)),
				);
				yield* Effect.gen(function* () {
					const service = yield* IngestionReadinessService;
					const input = { settings: {}, userId: owner, installationId: installed.installation.id };
					expect(
						(yield* service.evaluateImport({ ...input, sourceSlug: slug })).readiness.ready,
					).toBe(true);
					expect(
						(yield* service.evaluateIntegration({ ...input, providerSlug: slug })).readiness.ready,
					).toBe(true);
					assertExitFails(
						yield* Effect.exit((yield* PluginRepository).validateConfigurationKeys()),
						new DbError({
							message: "Retained plugin configuration references an unavailable encryption key",
						}),
					);
					assertExitFails(
						yield* Effect.exit(
							(yield* PluginRuntimeResolver).resolvePluginConfigContext({
								id: configId,
								ownerUserId: owner,
								pluginRevisionId: installed.revisionId,
							}),
						),
						new DbError({
							message: `Plugin configuration ${configId} is unavailable or failed authentication`,
						}),
					);
				}).pipe(
					Effect.ensuring(
						database
							.run((db) =>
								db
									.update(tables.pluginConfigRevision)
									.set({ encryptionKeyId: stored.encryptionKeyId })
									.where(eq(tables.pluginConfigRevision.id, configId)),
							)
							.pipe(Effect.orDie),
					),
				);
			}),
	);
	test.effect("evaluates integration settings branches from the exact installed declaration", () =>
		Effect.gen(function* () {
			const fixture = revisionPackage("planned-sync");
			const manifest: PluginManifest = {
				...fixture.manifest,
				integrationProviders: [
					{
						lot: "sink",
						slug: "planned-sync",
						name: "Planned sync",
						description: "Planned sync",
						scriptSlug: "planned-sync.task",
						plan: {
							selections: { collector: { field: "mode", cases: { api: "api", export: "export" } } },
						},
						settingsSchema: {
							unknownKeys: "strict",
							fields: {
								mode: {
									type: "enum",
									label: "Mode",
									description: "Mode",
									defaultValue: "export",
									choices: { kind: "static", values: [{ value: "api" }, { value: "export" }] },
								},
							},
						},
					},
				],
				scripts: fixture.manifest.scripts.map((script) => {
					if (script.slug.endsWith(".task")) {
						return {
							...script,
							executableDependencies: [
								{
									kind: "workflow",
									slug: "planned-sync-flow",
									selection: { key: "api", id: "collector", stage: "settings" },
								},
								{
									kind: "workflow",
									slug: KERNEL_ENTITY_IMPORT_WORKFLOW,
									selection: { key: "export", id: "collector", stage: "settings" },
								},
							],
						};
					}
					return script.slug.endsWith(".workflow")
						? Object.assign({}, script, { requiredPluginConfigKeys: ["token"] })
						: script;
				}),
			};
			const installed = yield* installRevisionPackage(
				{
					...fixture,
					manifest,
					scripts: manifest.scripts.map(({ entry, ...metadata }) => {
						const compiled = fixture.scripts.find((script) => script.entry === entry);
						assert(compiled);
						return Object.assign({}, compiled, { metadata });
					}),
				},
				owner,
			);
			const service = yield* IngestionReadinessService;
			const input = {
				userId: owner,
				providerSlug: "planned-sync",
				installationId: installed.installation.id,
			};
			expect((yield* service.evaluateIntegration(input)).readiness).toEqual({
				plan: null,
				ready: true,
				blockReasons: [],
			});
			const selected = yield* service.evaluateIntegration({ ...input, settings: {} });
			expect(selected.readiness).toEqual({
				ready: true,
				blockReasons: [],
				plan: { operation: "planned-sync.task", selection: { collector: "export" } },
			});
			expect(selected.pins.pluginRevisionId).toBe(installed.revisionId);
			expect(
				(yield* service.evaluateIntegration({ ...input, settings: { mode: "api" } })).readiness
					.blockReasons,
			).toEqual([{ key: "token", code: "configuration-required" }]);
			assert(selected.readiness.plan);
			expect(
				(yield* service.evaluateIntegration({
					...input,
					settings: {},
					acceptedPlan: selected.readiness.plan,
				})).readiness,
			).toEqual(selected.readiness);
			expect(
				(yield* Effect.flip(
					service.evaluateIntegration({
						...input,
						settings: { mode: "api" },
						acceptedPlan: selected.readiness.plan,
					}),
				)).message,
			).toBe("Accepted ingestion plan does not match selected settings");
		}),
	);
	test.effect(
		"validates selected import plans after applying schema defaults and checks installation identity",
		() =>
			Effect.gen(function* () {
				const fixture = revisionPackage("planned-import");
				const manifest: PluginManifest = {
					...fixture.manifest,
					importSources: [
						{
							slug: "planned-import",
							name: "Planned import",
							description: "Planned import",
							workflowSlug: "planned-import-flow",
							plan: {
								selections: {
									collector: { field: "mode", cases: { user: "api", export: "export" } },
								},
							},
							inputSchema: {
								unknownKeys: "strict",
								fields: {
									mode: {
										type: "enum",
										label: "Mode",
										description: "Mode",
										defaultValue: "export",
										choices: { kind: "static", values: [{ value: "user" }, { value: "export" }] },
									},
								},
							},
						},
					],
					scripts: fixture.manifest.scripts.map((script) => {
						if (script.slug.endsWith(".workflow")) {
							return {
								...script,
								executableDependencies: [
									{
										kind: "script",
										slug: "planned-import.task",
										selection: { key: "api", id: "collector", stage: "settings" },
									},
									{
										kind: "workflow",
										slug: KERNEL_ENTITY_IMPORT_WORKFLOW,
										selection: { key: "export", id: "collector", stage: "settings" },
									},
								],
							};
						}
						return script.slug.endsWith(".task")
							? { ...script, requiredPluginConfigKeys: ["token"] }
							: script;
					}),
				};
				const installed = yield* installRevisionPackage(
					{
						...fixture,
						manifest,
						scripts: manifest.scripts.map(({ entry, ...metadata }) => {
							const compiled = fixture.scripts.find((script) => script.entry === entry);
							assert(compiled);
							return Object.assign({}, compiled, { metadata });
						}),
					},
					owner,
				);
				const service = yield* IngestionReadinessService;
				const input = {
					userId: owner,
					sourceSlug: "planned-import",
					installationId: installed.installation.id,
				};
				expect((yield* service.evaluateImport(input)).readiness).toEqual({
					plan: null,
					ready: true,
					blockReasons: [],
				});
				const selected = yield* service.evaluateImport({ ...input, settings: {} });
				expect(selected.readiness).toEqual({
					ready: true,
					blockReasons: [],
					plan: { operation: "planned-import-flow", selection: { collector: "export" } },
				});
				expect(selected.pins.pluginRevisionId).toBe(installed.revisionId);
				expect(
					(yield* service.evaluateImport({ ...input, settings: { mode: "user" } })).readiness
						.blockReasons,
				).toEqual([{ key: "token", code: "configuration-required" }]);
				expect(
					(yield* Effect.flip(
						service.evaluateImport({
							...input,
							settings: {},
							acceptedPlan: { selection: { collector: "api" }, operation: "planned-import-flow" },
						}),
					)).message,
				).toBe("Accepted ingestion plan does not match selected settings");
				expect(
					(yield* Effect.flip(
						service.evaluateImport({ ...input, settings: { mode: "unsupported" } }),
					)).message,
				).toBe("Invalid ingestion settings");
				expect(
					(yield* Effect.flip(
						service.evaluateImport({ ...input, installationId: "other-installation" }),
					)).message,
				).toBe("Import source operation is unavailable");
			}),
	);
	test.effect(
		"uses exact private config metadata and validates account identity without refreshing or binding",
		() =>
			Effect.gen(function* () {
				const fixture = oauthRevisionPackage("private-readiness", "private-readiness-yank");
				const source = {
					...fixture,
					scripts: fixture.scripts.map((script) =>
						script.slug.endsWith(".task")
							? {
									...script,
									metadata: {
										...script.metadata,
										oauthConnectionFields: ["account"],
										requiredPluginConfigKeys: ["enabled", "threshold"],
									},
								}
							: script,
					),
					manifest: {
						...fixture.manifest,
						scripts: fixture.manifest.scripts.map((script) =>
							script.slug.endsWith(".task")
								? {
										...script,
										oauthConnectionFields: ["account"],
										requiredPluginConfigKeys: ["enabled", "threshold"],
									}
								: script,
						),
						integrationProviders: fixture.manifest.integrationProviders.map((provider) =>
							Object.assign({}, provider, {
								settingsSchema: {
									...provider.settingsSchema,
									fields: {
										...provider.settingsSchema.fields,
										account: {
											...provider.settingsSchema.fields.account,
											validation: { required: true as const },
										},
									},
								},
							}),
						),
						configSchema: {
							...fixture.manifest.configSchema,
							fields: {
								...fixture.manifest.configSchema.fields,
								enabled: {
									label: "Enabled",
									defaultValue: false,
									description: "Enabled",
									type: "boolean" as const,
								},
								threshold: {
									defaultValue: 0,
									label: "Threshold",
									description: "Threshold",
									type: "integer" as const,
								},
							},
						},
					},
				};
				const installed = yield* installRevisionPackage(source, owner);
				const service = yield* IngestionReadinessService;
				const input = {
					settings: {},
					userId: owner,
					providerSlug: "private-readiness-yank",
					installationId: installed.installation.id,
				};
				const blocked = yield* service
					.evaluateIntegration(input)
					.pipe(
						Effect.provideService(
							ConfigProvider.ConfigProvider,
							ConfigProvider.fromUnknown({
								[pluginConfigEnvironmentKey(source.manifest.metadata.packageId, "clientId")]:
									"environment-id",
								[pluginConfigEnvironmentKey(source.manifest.metadata.packageId, "clientSecret")]:
									"environment-secret",
							}),
						),
					);
				expect(blocked.readiness.blockReasons).toEqual([
					{ key: "account", code: "connection-required" },
					{ key: "clientId", code: "oauth-client-required" },
					{ key: "clientSecret", code: "oauth-client-required" },
				]);
				const configured = yield* (yield* PluginInstallationRepository).updateState({
					sortOrder: 0,
					isHidden: false,
					id: installed.installation.id,
					config: {
						threshold: 0,
						enabled: false,
						clientId: "private-id",
						clientSecret: "private-secret",
					},
				});
				assert(configured?.activeConfigRevisionId);
				const ownershipFailure = yield* Effect.flip(
					(yield* PluginConfigRevisions).read({
						ownerUserId: owner,
						id: configured.activeConfigRevisionId,
						pluginRevisionId: installed.revisionId,
						pluginInstallationId: "other-installation",
					}),
				);
				expect(ownershipFailure.message).toBe("Invalid pinned plugin configuration ownership");
				const inputWithConnection = { ...input, settings: { account: "readiness-account" } };
				expect(
					(yield* service.evaluateIntegration(inputWithConnection)).readiness.blockReasons,
				).toEqual([{ key: "account", code: "connection-required" }]);
				yield* (yield* DatabaseSession).run((db) =>
					db
						.insert(tables.oauthConnection)
						.values({
							userId: owner,
							field: "account",
							status: "connected",
							id: "readiness-account",
							client: { kind: "web" },
							oauthProviderSlug: "account",
							stateHash: "readiness-state",
							pluginInstallationId: installed.installation.id,
							tokenUrlOrigin: "https://accounts.example.test",
							integrationProviderSlug: "private-readiness-yank",
						}),
				);
				const ready = yield* service.evaluateIntegration(inputWithConnection);
				expect(ready.readiness).toEqual({
					ready: true,
					blockReasons: [],
					plan: { selection: {}, operation: "private-readiness.task" },
				});
				expect(ready.pins.pluginConfigRevisionId).toBe(configured.activeConfigRevisionId);
				const readProjection = (yield* DatabaseSession).run((db) =>
					db
						.select({
							metadata: sql`${sql.raw(ingestionReadinessMetadataSql("user_integration_provider"))}`,
						})
						.from(tables.userIntegrationProvider)
						.where(
							and(
								eq(tables.userIntegrationProvider.slug, input.providerSlug),
								eq(tables.userIntegrationProvider.installationId, input.installationId),
								eq(tables.userIntegrationProvider.userId, owner),
							),
						),
				);
				const [projection] = yield* readProjection;
				expect(projection?.metadata).toEqual(ready.provider.readinessMetadata);
				expect(projection?.metadata).not.toHaveProperty("configSchema");
				expect(
					(yield* service.evaluateIntegration({
						...inputWithConnection,
						settings: { account: "another-account" },
					})).readiness.ready,
				).toBe(false);
				expect(
					(yield* service.evaluateIntegration({
						...inputWithConnection,
						acceptedPlan: { selection: {}, operation: "private-readiness.task" },
					})).readiness.ready,
				).toBe(true);
				yield* (yield* PluginInstallationRepository).updateState({
					sortOrder: 0,
					isHidden: false,
					id: installed.installation.id,
					config: { clientId: "", threshold: 0, enabled: false, clientSecret: "private-secret" },
				});
				const emptyClient = yield* service.evaluateIntegration(inputWithConnection);
				expect(emptyClient.readiness.blockReasons).toEqual([
					{ key: "clientId", code: "oauth-client-required" },
				]);
				expect(emptyClient.provider.readinessMetadata.availableConfigKeys).toEqual([
					"clientSecret",
					"enabled",
					"threshold",
				]);
				expect((yield* readProjection)[0]?.metadata).toEqual(
					emptyClient.provider.readinessMetadata,
				);
			}),
	);
});
