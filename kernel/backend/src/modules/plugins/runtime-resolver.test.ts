import { expect, it } from "@effect/vitest";
import { SandboxProviderId, SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Result } from "effect";
import { assert, describe } from "vitest";

import { PluginInstallationRepository } from "./installation-repository";
import { PluginLoader } from "./loader";
import { PluginRepository } from "./repository";
import {
	installRevisionPackage,
	revisionPackage,
	withRevisionDatabase,
} from "./revision.test-support";
import { PluginRuntimeResolver } from "./runtime-resolver";

const owner = UserId.make("owner");
const other = UserId.make("recipient");

describe("revision-backed runtime resolution", () => {
	it.effect(
		"resolves provider declarations and operation-specific scripts from the active revision",
		() =>
			withRevisionDatabase(
				Effect.gen(function* () {
					const runtime = yield* PluginRuntimeResolver;
					const installed = yield* installRevisionPackage(revisionPackage());
					const fixtureProvider = yield* runtime.findSchemaProviderBySlug("fixture-provider");
					assert(fixtureProvider);
					expect(fixtureProvider.entitySchemaSlug).toBe("fixture-entity");
					expect(fixtureProvider.provider.pluginId).toBe(installed.pluginId);
					expect((yield* runtime.resolveDetailsScript(fixtureProvider.provider.id)).slug).toBe(
						"fixture.details",
					);
					expect((yield* runtime.resolveSearchScript(fixtureProvider.provider.id)).slug).toBe(
						"fixture.search",
					);
					expect(
						(yield* runtime.resolveUserDetailsScript(owner, fixtureProvider.provider.id))
							.pluginRevisionId,
					).toBe(installed.revisionId);
					expect(
						(yield* runtime.listSchemaProviders({ userId: owner })).map(
							({ provider }) => provider.id,
						),
					).toEqual([fixtureProvider.provider.id]);
					expect(yield* runtime.listSchemaProviders({ userId: other })).toEqual([]);
					expect(
						yield* runtime.findAuthorizedSchemaProviderById({
							pluginSlug: "fixture",
							entitySchemaSlug: "fixture-entity",
							providerId: fixtureProvider.provider.id,
						}),
					).not.toBeNull();
					expect(
						yield* runtime.findAuthorizedSchemaProviderById({
							pluginSlug: "foreign",
							entitySchemaSlug: "fixture-entity",
							providerId: fixtureProvider.provider.id,
						}),
					).toBeNull();
					expect(
						yield* runtime.findAuthorizedSchemaProviderById({
							pluginSlug: "fixture",
							entitySchemaSlug: "wrong-entity",
							providerId: fixtureProvider.provider.id,
						}),
					).toBeNull();
				}),
			),
	);

	it.effect(
		"returns contextual errors for unknown, inactive, and undeclared provider operations",
		() =>
			withRevisionDatabase(
				Effect.gen(function* () {
					const runtime = yield* PluginRuntimeResolver;
					const plugins = yield* PluginRepository;
					const installed = yield* installRevisionPackage(revisionPackage());
					const provider = yield* runtime.findSchemaProviderBySlug("fixture-provider");
					assert(provider);
					const unsupported = yield* Effect.result(
						runtime.resolveTranslateScript(provider.provider.id),
					);
					assert(Result.isFailure(unsupported));
					expect(unsupported.failure).toMatchObject({
						operation: "translate",
						reason: "unsupported_operation",
						providerSlug: "fixture-provider",
						_tag: "UnsupportedProviderOperationError",
					});
					expect(
						yield* runtime.findActiveProviderById(SandboxProviderId.make("absent")),
					).toBeNull();
					yield* plugins.deactivate(installed.pluginId);
					const inactive = yield* Effect.result(runtime.resolveDetailsScript(provider.provider.id));
					assert(Result.isFailure(inactive));
					expect(inactive.failure).toMatchObject({ reason: "inactive_provider" });
				}),
			),
	);

	it.effect("excludes disabled, unhealthy, and uninstalled installations from new resolution", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
				const runtime = yield* PluginRuntimeResolver;
				const installations = yield* PluginInstallationRepository;
				const installed = yield* installRevisionPackage(revisionPackage());
				yield* installations.updateState({
					config: {},
					sortOrder: 0,
					isDisabled: true,
					id: installed.installation.id,
				});
				expect(yield* runtime.listPluginsAvailableToUser(owner)).toEqual([]);
				expect(
					yield* runtime.findScriptAvailableToUser(owner, installed.pluginId, "fixture.details"),
				).toBeNull();
				expect((yield* runtime.listPluginsAvailableToUser(owner, true)).length).toBe(1);
				yield* installations.updateState({
					config: {},
					sortOrder: 0,
					isDisabled: false,
					id: installed.installation.id,
				});
				yield* installations.updateHealth({
					healthReason: null,
					id: installed.installation.id,
					health: "needs-configuration",
				});
				expect(yield* runtime.listSchemaProviders({ userId: owner })).toEqual([]);
				yield* installations.remove(installed.installation.id);
				expect(yield* runtime.listPluginsAvailableToUser(owner, true)).toEqual([]);
			}),
		),
	);

	it.effect(
		"uses the exact private installation and never publishes private packages to the loader",
		() =>
			withRevisionDatabase(
				Effect.gen(function* () {
					const runtime = yield* PluginRuntimeResolver;
					const loader = yield* PluginLoader;
					const first = yield* installRevisionPackage(revisionPackage("notes"), owner);
					const second = yield* installRevisionPackage(revisionPackage("notes"), other);
					expect(Object.keys(loader.getSnapshot().plugins)).toEqual([]);
					const ownScript = yield* runtime.findScriptAvailableToUser(
						owner,
						first.pluginId,
						"notes.details",
					);
					const otherScript = yield* runtime.findScriptAvailableToUser(
						other,
						second.pluginId,
						"notes.details",
					);
					assert(ownScript && otherScript);
					expect(ownScript.id).not.toBe(otherScript.id);
					expect(ownScript.pluginRevisionId).toBe(first.revisionId);
					expect(otherScript.pluginRevisionId).toBe(second.revisionId);
					expect(
						yield* runtime.findScriptAvailableToUser(other, first.pluginId, "notes.details"),
					).toBeNull();
					expect((yield* runtime.listPluginsAvailableToUser(owner)).map(({ id }) => id)).toEqual([
						first.pluginId,
					]);
					expect(
						yield* runtime.findWorkflowScriptAvailableToUser(
							owner,
							first.pluginId,
							"notes-flow",
							second.installation.id,
						),
					).toBeNull();
				}),
			),
	);

	it.effect(
		"keeps captured catalog operations pinned while new requests select the upgraded revision",
		() =>
			withRevisionDatabase(
				Effect.gen(function* () {
					const runtime = yield* PluginRuntimeResolver;
					const first = yield* installRevisionPackage(revisionPackage("notes", "v1"), owner);
					const captured = yield* runtime.findPluginAvailableToUser(owner, first.pluginId);
					assert(captured);
					const oldScript = yield* runtime.findWorkflowScriptInAvailablePlugin(
						captured,
						"notes-flow",
					);
					assert(oldScript);
					const second = yield* installRevisionPackage(revisionPackage("notes", "v2"), owner);
					expect(second.pluginId).toBe(first.pluginId);
					expect(second.installation.id).toBe(first.installation.id);
					expect(second.revisionId).not.toBe(first.revisionId);
					expect(
						(yield* runtime.findWorkflowScriptInAvailablePlugin(captured, "notes-flow"))?.id,
					).toBe(oldScript.id);
					expect(
						(yield* runtime.findWorkflowScriptAvailableToUser(
							owner,
							first.pluginId,
							"notes-flow",
							first.installation.id,
						))?.contentHash,
					).toBe("notes.workflow-v2");
					expect(
						yield* runtime.findActiveScriptById(SandboxScriptId.make(oldScript.id)),
					).toBeNull();
				}),
			),
	);

	it.effect(
		"requires configuration to belong to the selected package before exposing a ready catalog entry",
		() =>
			withRevisionDatabase(
				Effect.gen(function* () {
					const runtime = yield* PluginRuntimeResolver;
					const plugins = yield* PluginRepository;
					const installed = yield* installRevisionPackage(revisionPackage("notes", "v1"), owner);
					yield* plugins.persist(revisionPackage("notes", "v2"), {
						slug: "notes",
						scope: "user",
						ownerId: owner,
					});
					expect(yield* runtime.listPluginsAvailableToUser(owner)).toEqual([]);
					const [pending] = yield* runtime.listPluginsAvailableToUser(owner, true);
					expect(pending?.id).toBe(installed.pluginId);
				}),
			),
	);

	it.effect(
		"recomputes effective definitions and includes installing private packages only when requested",
		() =>
			withRevisionDatabase(
				Effect.gen(function* () {
					const runtime = yield* PluginRuntimeResolver;
					const installations = yield* PluginInstallationRepository;
					const installed = yield* installRevisionPackage(revisionPackage("notes"), owner);
					expect(
						(yield* runtime.getEffectiveDefinitions(owner)).entitySchemas["notes-entity"]?.pluginId,
					).toBe(installed.pluginId);
					yield* installations.updateHealth({
						healthReason: null,
						health: "installing",
						id: installed.installation.id,
					});
					expect(
						(yield* runtime.getEffectiveDefinitions(owner)).entitySchemas["notes-entity"],
					).toBeUndefined();
					expect(
						(yield* runtime.getEffectiveDefinitions(owner, true)).entitySchemas["notes-entity"]
							?.pluginId,
					).toBe(installed.pluginId);
					yield* installations.updateHealth({
						health: "incompatible",
						healthReason: "conflict",
						id: installed.installation.id,
					});
					expect(
						(yield* runtime.getEffectiveDefinitions(owner, true)).entitySchemas["notes-entity"],
					).toBeUndefined();
				}),
			),
	);

	it.effect(
		"lets shipped definitions win a private collision without dropping independent private definitions",
		() =>
			withRevisionDatabase(
				Effect.gen(function* () {
					const runtime = yield* PluginRuntimeResolver;
					const privatePackage = revisionPackage("notes", "v1", "shared-entity");
					const entity = privatePackage.manifest.entitySchemas[0];
					assert(entity);
					const privatePlugin = yield* installRevisionPackage(
						{
							...privatePackage,
							manifest: {
								...privatePackage.manifest,
								entitySchemas: [
									...privatePackage.manifest.entitySchemas,
									{ ...entity, slug: "notes-extra" },
								],
							},
						},
						owner,
					);
					const system = yield* installRevisionPackage(
						revisionPackage("shared", "v1", "shared-entity"),
					);
					const definitions = yield* runtime.getEffectiveDefinitions(owner);
					expect(definitions.entitySchemas["shared-entity"]?.pluginId).toBe(system.pluginId);
					expect(definitions.entitySchemas["notes-extra"]?.pluginId).toBe(privatePlugin.pluginId);
				}),
			),
	);

	it.effect("resolves cron and bootstrap declarations against their package revision", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
				const runtime = yield* PluginRuntimeResolver;
				const packageValue = revisionPackage();
				const installed = yield* installRevisionPackage({
					...packageValue,
					manifest: {
						...packageValue.manifest,
						userBootstrap: [
							{ slug: "user-startup", scriptSlug: "fixture.task", description: "User startup" },
						],
						crons: [
							{
								slug: "scheduled",
								description: "Scheduled",
								scriptSlug: "fixture.task",
								schedule: { cron: "* * * * *" },
							},
						],
					},
				});
				expect(
					(yield* runtime.resolveActivePluginCron({ pluginSlug: "fixture", cronSlug: "scheduled" }))
						?.script.pluginRevisionId,
				).toBe(installed.revisionId);
				expect(
					(yield* runtime.resolveActivePluginUserBootstrap({
						pluginSlug: "fixture",
						bootstrapSlug: "user-startup",
					}))?.script.pluginRevisionId,
				).toBe(installed.revisionId);
				expect(
					(yield* runtime.resolveInstallationBootstrap(installed.installation.id))?.entries,
				).toHaveLength(1);
			}),
		),
	);

	it.effect("schedules private crons only for ready enabled exact installations", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
				const runtime = yield* PluginRuntimeResolver;
				const installations = yield* PluginInstallationRepository;
				const packageValue = revisionPackage("notes");
				const installed = yield* installRevisionPackage(
					{
						...packageValue,
						manifest: {
							...packageValue.manifest,
							crons: [
								{
									slug: "scheduled",
									scriptSlug: "notes.task",
									description: "Scheduled",
									schedule: { cron: "* * * * *" },
								},
							],
						},
					},
					owner,
				);
				expect(
					(yield* runtime.listPrivateCronSchedules()).map(({ installationId }) => installationId),
				).toEqual([installed.installation.id]);
				expect(
					(yield* runtime.resolvePrivatePluginCron({
						cronSlug: "scheduled",
						installationId: installed.installation.id,
					}))?.userId,
				).toBe(owner);
				yield* installations.updateState({
					config: {},
					sortOrder: 0,
					isDisabled: true,
					id: installed.installation.id,
				});
				expect(yield* runtime.listPrivateCronSchedules()).toEqual([]);
				expect(
					yield* runtime.resolvePrivatePluginCron({
						cronSlug: "scheduled",
						installationId: installed.installation.id,
					}),
				).toBeNull();
			}),
		),
	);
});

describe("catalog reads across revision boundaries", () => {
	it.effect("serves the upgraded manifest and the upgraded script rows after a reinstall", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
				const plugins = yield* PluginRepository;
				const runtime = yield* PluginRuntimeResolver;
				const first = yield* installRevisionPackage(revisionPackage("fixture", "v1"));
				const provider = yield* runtime.findSchemaProviderBySlug("fixture-provider");
				assert(provider);
				const firstScript = yield* runtime.resolveDetailsScript(provider.provider.id);
				expect((yield* plugins.list())[0]?.manifest.metadata.version).toBe("v1");

				const second = yield* installRevisionPackage(revisionPackage("fixture", "v2"));
				expect(second.revisionId).not.toBe(first.revisionId);
				expect((yield* plugins.list())[0]?.manifest.metadata.version).toBe("v2");
				const secondScript = yield* runtime.resolveDetailsScript(provider.provider.id);
				expect(secondScript.id).not.toBe(firstScript.id);
				expect(secondScript.contentHash).toBe("fixture.details-v2");
			}),
		),
	);

	it.effect(
		"stops resolving a deactivated plugin's provider while its revision stays readable",
		() =>
			withRevisionDatabase(
				Effect.gen(function* () {
					const plugins = yield* PluginRepository;
					const runtime = yield* PluginRuntimeResolver;
					const installed = yield* installRevisionPackage(revisionPackage());
					const provider = yield* runtime.findSchemaProviderBySlug("fixture-provider");
					assert(provider);
					expect((yield* runtime.listPluginsAvailableToUser(owner)).length).toBe(1);

					yield* plugins.deactivate(installed.pluginId);
					expect(
						(yield* plugins.readRevision(installed.revisionId)).manifest.providers,
					).toHaveLength(1);
					expect(yield* runtime.findSchemaProviderBySlug("fixture-provider")).toBeNull();
					expect(yield* runtime.findActiveProviderById(provider.provider.id)).toBeNull();
					expect(yield* runtime.listPluginsAvailableToUser(owner)).toEqual([]);
				}),
			),
	);

	it.effect("stops resolving a provider the new active revision no longer declares", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
				const runtime = yield* PluginRuntimeResolver;
				yield* installRevisionPackage(revisionPackage("fixture", "v1"));
				const provider = yield* runtime.findSchemaProviderBySlug("fixture-provider");
				assert(provider);

				const upgraded = revisionPackage("fixture", "v2");
				yield* installRevisionPackage({
					...upgraded,
					scripts: upgraded.scripts.filter(({ metadata }) => metadata.kind !== "provider"),
					manifest: {
						...upgraded.manifest,
						providers: [],
						scripts: upgraded.manifest.scripts.filter(({ kind }) => kind !== "provider"),
					},
				});
				expect(yield* runtime.findSchemaProviderBySlug("fixture-provider")).toBeNull();
				expect(yield* runtime.findActiveProviderById(provider.provider.id)).toBeNull();
			}),
		),
	);
});
