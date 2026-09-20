import { assert, expect, layer } from "@effect/vitest";
import { KERNEL_ENTITY_IMPORT_WORKFLOW } from "@ryot-app/contract/modules/plugins/execution";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { eq, sql } from "drizzle-orm";
import { Effect, Layer } from "effect";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { makeConfigProviderLayer } from "#lib/test-utils/effect";
import { OAuthConnectionsRepository } from "#modules/oauth-connections/repository";

import { PluginConfigRevisions } from "./config-revisions";
import { ImportSourceCatalog } from "./import-source-catalog";
import { ingestionReadinessMetadataSql } from "./ingestion-readiness-projection";
import { IngestionReadinessService } from "./ingestion-readiness-service";
import { PluginInstallationRepository } from "./installation-repository";
import { IntegrationProviderCatalog } from "./integration-provider-catalog";
import {
	installRevisionPackage,
	oauthRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "./revision.test-support";

const owner = UserId.make("owner");
const dependencies = Layer.mergeAll(
	ImportSourceCatalog.layer,
	IntegrationProviderCatalog.layer,
	OAuthConnectionsRepository.layer,
).pipe(Layer.provideMerge(revisionDatabaseLayer));
const services = Layer.effect(IngestionReadinessService, IngestionReadinessService.make).pipe(
	Layer.provideMerge(
		Layer.merge(
			dependencies,
			makeConfigProviderLayer({
				RYOT_PLUGIN_PRIVATE_READINESS_CLIENT_ID: "environment-id",
				RYOT_PLUGIN_PRIVATE_READINESS_CLIENT_SECRET: "environment-secret",
			}),
		),
	),
);

layer(services)((test) => {
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
		"reads exact private config and validates account identity without refreshing or binding",
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
				const blocked = yield* service.evaluateIntegration(input);
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
							pluginSlug: "private-readiness",
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
						.where(eq(tables.userIntegrationProvider.slug, input.providerSlug)),
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
