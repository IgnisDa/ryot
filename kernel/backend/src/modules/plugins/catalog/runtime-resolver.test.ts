import { expect, layer } from "@effect/vitest";
import {
	CLIENT_API_VERSION,
	type PluginClientEntry,
	type PluginManifest,
} from "@ryot-app/contract/modules/plugins/manifest";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	EntitySchemaSlug,
	PluginId,
	type PluginPackageId,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import {
	clientArtifactMetadata,
	clientDeclarationHash,
	type PluginClientImport,
	pluginExportSpecifier,
} from "@ryot-app/plugin-client-contract";
import { and, eq, sql } from "drizzle-orm";
import { Effect, Result } from "effect";
import { assert, describe } from "vitest";

import { DefinitionRepository } from "#modules/definitions/repository";
import { definitionLookup } from "#modules/definitions/snapshot";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import { PluginInstallationRepository } from "../installations/repository";
import { PluginRepository } from "../packages/repository";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "../packages/revision.test-support";
import type { NormalizedPlugin } from "../packages/types";
import { testPluginPackageId } from "../test-support";
import { PluginRuntimeResolver } from "./runtime-resolver";

const owner = UserId.make("owner");
const other = UserId.make("recipient");

const operationPackage = (version: string, packageId?: PluginPackageId) => {
	const value = revisionPackage("whiskey", version, undefined, packageId);
	return {
		...value,
		scripts: value.scripts.map((script) =>
			script.metadata.kind === "script"
				? Object.assign({}, script, {
						metadata: Object.assign({}, script.metadata, { kind: "operation" as const }),
					})
				: script,
		),
		manifest: {
			...value.manifest,
			scripts: value.manifest.scripts.map((script) =>
				script.kind === "script"
					? Object.assign({}, script, { kind: "operation" as const })
					: script,
			),
			operations: [
				{
					auth: "user" as const,
					slug: "same-operation",
					description: "Operation",
					scriptSlug: "whiskey.task",
					demoAccess: "allowed" as const,
				},
			],
		},
	};
};

const providerScriptFields = {
	runtimeImports: [],
	kind: "provider" as const,
	capabilities: [] as const,
	oauthConnectionFields: [] as const,
	executableDependencies: [] as const,
	requiredPluginConfigKeys: [] as const,
	optionalPluginConfigKeys: [] as const,
};

const providerScript = (
	providerSlug: string,
	providerOperation: "details" | "resolve" | "search-options" | "translate",
) => ({
	...providerScriptFields,
	providerSlug,
	providerOperation,
	name: providerOperation,
	slug: `${providerSlug}.${providerOperation}`,
	entry: `backend/${providerSlug}-${providerOperation}.sandbox.ts`,
});

const multiProvider = (slug: string) => ({
	slug,
	name: slug,
	information: { source: "fixture" },
	rootEntitySchemaSlug: "multi-entity",
});

const multiProviderPackage = (
	version: string,
	retired: boolean,
	packageId?: PluginPackageId,
): NormalizedPlugin => {
	const value = revisionPackage("multi", version, undefined, packageId);
	const manifest: PluginManifest = {
		...value.manifest,
		providers: [
			multiProvider("multi-provider"),
			multiProvider("multi-second"),
			...(retired ? [multiProvider("multi-retired")] : []),
		],
		scripts: [
			...value.manifest.scripts.filter(({ kind }) => kind !== "provider"),
			providerScript("multi-provider", "details"),
			providerScript("multi-provider", "resolve"),
			providerScript("multi-provider", "translate"),
			providerScript("multi-provider", "search-options"),
			{
				...providerScriptFields,
				name: "search",
				providerOperation: "search",
				slug: "multi-provider.search",
				providerSlug: "multi-provider",
				searchOptionsSchema: { fields: {} },
				entry: "backend/multi-provider-search.sandbox.ts",
			},
			providerScript("multi-second", "details"),
			...(retired ? [providerScript("multi-retired", "details")] : []),
		],
	};
	return {
		manifest,
		contentHash: `multi-${version}`,
		scripts: manifest.scripts.map(({ entry, ...metadata }) => ({
			entry,
			metadata,
			compiledFormat: 1,
			slug: metadata.slug,
			name: metadata.name,
			compiledCode: version,
			contentHash: `${metadata.slug}-${version}`,
		})),
	};
};

const schedulePackage = () => {
	const value = revisionPackage("whiskey");
	return {
		...value,
		manifest: {
			...value.manifest,
			crons: [
				{
					slug: "scheduled",
					description: "Scheduled",
					scriptSlug: "whiskey.task",
					schedule: { cron: "* * * * *" },
				},
			],
		},
	};
};

const withClient = (
	value: ReturnType<typeof revisionPackage>,
	client: PluginClientEntry,
	imports: readonly PluginClientImport[],
) => {
	const files = [
		{
			name: "index.html",
			contentType: "text/html; charset=utf-8",
			contents: new TextEncoder().encode("<!doctype html><html></html>"),
		},
		{
			name: "plugin.js",
			contentType: "text/javascript; charset=utf-8",
			contents: new TextEncoder().encode(
				imports
					.map(
						(entry) =>
							`import ${JSON.stringify(pluginExportSpecifier(entry.reference, entry.exportName))};`,
					)
					.join("\n"),
			),
		},
	];
	return {
		...value,
		manifest: { ...value.manifest, client },
		compiledClient: {
			...clientArtifactMetadata(
				value.manifest.metadata.name,
				value.manifest.metadata.packageId,
				files,
				{ imports, clientDeclarationHash: clientDeclarationHash(client) },
			),
			files,
		},
	};
};

describe("revision-backed runtime resolution", () => {
	layer(revisionDatabaseLayer)((test) => {
		test.effect(
			"selects same-name providers and operations by owner without system preference",
			() =>
				Effect.gen(function* () {
					const runtime = yield* PluginRuntimeResolver;
					const privatePlugin = yield* installRevisionPackage(operationPackage("private"), owner);
					const system = yield* installRevisionPackage(operationPackage("system"));
					const ownReference = {
						slug: "whiskey-provider",
						owner: definitionOwner(privatePlugin.pluginId),
					};
					const ownProvider = yield* runtime.findProviderAvailableToUserByReference(
						owner,
						ownReference,
					);
					assert(ownProvider);
					expect(ownProvider.pluginId).toBe(privatePlugin.pluginId);
					expect(
						(yield* runtime.findSchemaProviderByReference({
							slug: "whiskey-provider",
							owner: definitionOwner(system.pluginId),
						}))?.provider.pluginId,
					).toBe(system.pluginId);
					expect(yield* runtime.findSchemaProviderByReference(ownReference)).toBeNull();
					expect(
						yield* runtime.findProviderAvailableToUserByReference(other, ownReference),
					).toBeNull();
					expect(
						yield* runtime.findProviderAvailableToUserByReference(owner, {
							slug: "whiskey-provider",
							owner: { kind: "kernel" },
						}),
					).toBeNull();
					expect(
						(yield* runtime.listSchemaProviders({
							userId: owner,
							entitySchemas: [
								{
									slug: EntitySchemaSlug.make("whiskey-entity"),
									owner: definitionOwner(privatePlugin.pluginId),
								},
							],
						})).map(({ provider }) => provider.pluginId),
					).toEqual([privatePlugin.pluginId]);
					expect(
						yield* runtime.findAuthorizedSchemaProviderById({
							providerId: ownProvider.id,
							entitySchema: {
								owner: definitionOwner(system.pluginId),
								slug: EntitySchemaSlug.make("whiskey-entity"),
							},
						}),
					).toBeNull();
					expect(
						(yield* runtime.findOperationAvailableToUser({
							userId: owner,
							operationSlug: "same-operation",
							pluginId: privatePlugin.pluginId,
						}))?.script.contentHash,
					).toBe("whiskey.task-private");
					expect(
						(yield* runtime.findOperationAvailableToUser({
							userId: owner,
							pluginId: system.pluginId,
							operationSlug: "same-operation",
						}))?.script.contentHash,
					).toBe("whiskey.task-system");
					expect(
						yield* runtime.findOperationAvailableToUser({
							userId: other,
							operationSlug: "same-operation",
							pluginId: privatePlugin.pluginId,
						}),
					).toBeNull();
					expect(
						yield* runtime.findOperationAvailableToUser({
							userId: owner,
							operationSlug: "same-operation",
							pluginId: PluginId.make("absent"),
						}),
					).toBeNull();
				}),
		);
	});
	layer(revisionDatabaseLayer)((test) => {
		test.effect(
			"resolves provider declarations and operation-specific scripts from the active revision",
			() =>
				Effect.gen(function* () {
					const runtime = yield* PluginRuntimeResolver;
					const installed = yield* installRevisionPackage(revisionPackage());
					const fixtureProvider = yield* runtime.findSchemaProviderByReference({
						slug: "fixture-provider",
						owner: definitionOwner(installed.pluginId),
					});
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
							providerId: fixtureProvider.provider.id,
							entitySchema: {
								owner: definitionOwner(installed.pluginId),
								slug: EntitySchemaSlug.make("fixture-entity"),
							},
						}),
					).not.toBeNull();
					expect(
						yield* runtime.findAuthorizedSchemaProviderById({
							providerId: fixtureProvider.provider.id,
							entitySchema: {
								owner: definitionOwner("foreign"),
								slug: EntitySchemaSlug.make("fixture-entity"),
							},
						}),
					).toBeNull();
					expect(
						yield* runtime.findAuthorizedSchemaProviderById({
							providerId: fixtureProvider.provider.id,
							entitySchema: {
								owner: definitionOwner(installed.pluginId),
								slug: EntitySchemaSlug.make("wrong-entity"),
							},
						}),
					).toBeNull();
				}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect(
			"returns contextual errors for unknown, inactive, and undeclared provider operations",
			() =>
				Effect.gen(function* () {
					const runtime = yield* PluginRuntimeResolver;
					const plugins = yield* PluginRepository;
					const installed = yield* installRevisionPackage(revisionPackage());
					const provider = yield* runtime.findSchemaProviderByReference({
						slug: "fixture-provider",
						owner: definitionOwner(installed.pluginId),
					});
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
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect(
			"excludes hidden, unhealthy, and uninstalled installations from new resolution",
			() =>
				Effect.gen(function* () {
					const runtime = yield* PluginRuntimeResolver;
					const installations = yield* PluginInstallationRepository;
					const installed = yield* installRevisionPackage(revisionPackage());
					yield* installations.updateState({
						config: {},
						sortOrder: 0,
						isHidden: true,
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
						isHidden: false,
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
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect("uses the exact private installation for private package scripts", () =>
			Effect.gen(function* () {
				const runtime = yield* PluginRuntimeResolver;
				const first = yield* installRevisionPackage(revisionPackage("notes"), owner);
				const second = yield* installRevisionPackage(revisionPackage("notes"), other);
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
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect("resolves an active private script only for its executing user", () =>
			Effect.gen(function* () {
				const runtime = yield* PluginRuntimeResolver;
				const privatePlugin = yield* installRevisionPackage(revisionPackage("retained"), owner);
				const systemPlugin = yield* installRevisionPackage(revisionPackage("retained"));
				const privateScript = yield* runtime.findScriptAvailableToUser(
					owner,
					privatePlugin.pluginId,
					"retained.task",
				);
				const systemScript = yield* runtime.findScriptAvailableToUser(
					owner,
					systemPlugin.pluginId,
					"retained.task",
				);
				assert(privateScript && systemScript);

				expect(privateScript.id).not.toBe(systemScript.id);
				expect(yield* runtime.findActiveScriptById(privateScript.id, owner)).toMatchObject({
					contentHash: "retained.task-v1",
					pluginId: privatePlugin.pluginId,
				});
				expect(yield* runtime.findActiveScriptById(privateScript.id, other)).toBeNull();
				expect(yield* runtime.findActiveScriptById(privateScript.id, null)).toBeNull();
				expect(yield* runtime.findActiveScriptById(systemScript.id, null)).toMatchObject({
					pluginId: systemPlugin.pluginId,
					contentHash: "retained.task-v1",
				});
			}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect(
			"keeps captured catalog operations pinned while new requests select the upgraded revision",
			() =>
				Effect.gen(function* () {
					const runtime = yield* PluginRuntimeResolver;
					const original = revisionPackage("notes", "v1");
					const first = yield* installRevisionPackage(original, owner);
					const captured = yield* runtime.findPluginAvailableToUser(owner, first.pluginId);
					assert(captured);
					expect(captured.clientImports).toEqual([]);
					const oldScript = yield* runtime.findWorkflowScriptInAvailablePlugin(
						captured,
						"notes-flow",
					);
					assert(oldScript);
					const second = yield* installRevisionPackage(
						revisionPackage("notes", "v2", "notes-entity", original.manifest.metadata.packageId),
						owner,
					);
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
						yield* runtime.findActiveScriptById(SandboxScriptId.make(oldScript.id), owner),
					).toBeNull();
				}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect(
			"requires configuration to belong to the selected package before exposing a ready catalog entry",
			() =>
				Effect.gen(function* () {
					const runtime = yield* PluginRuntimeResolver;
					const plugins = yield* PluginRepository;
					const original = revisionPackage("notes", "v1");
					const installed = yield* installRevisionPackage(original, owner);
					yield* (yield* DatabaseSession).transaction(
						plugins.persist(
							revisionPackage("notes", "v2", "notes-entity", original.manifest.metadata.packageId),
							{ scope: "user", ownerId: owner },
						),
					);
					expect(yield* runtime.listPluginsAvailableToUser(owner)).toEqual([]);
					const [pending] = yield* runtime.listPluginsAvailableToUser(owner, true);
					expect(pending?.id).toBe(installed.pluginId);
				}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect(
			"recomputes effective definitions and includes installing private packages only when requested",
			() =>
				Effect.gen(function* () {
					const definitions = yield* DefinitionRepository;
					const installations = yield* PluginInstallationRepository;
					const installed = yield* installRevisionPackage(revisionPackage("notes"), owner);
					const effective = (listed: boolean) => definitions.getUserSnapshot(owner, { listed });
					const reference = { slug: "notes-entity", owner: definitionOwner(installed.pluginId) };
					expect(
						definitionLookup(yield* effective(false)).getEntitySchema(reference)?.pluginId,
					).toBe(installed.pluginId);
					yield* installations.updateHealth({
						healthReason: null,
						health: "installing",
						id: installed.installation.id,
					});
					expect(
						definitionLookup(yield* effective(false)).getEntitySchema(reference),
					).toBeUndefined();
					expect(
						definitionLookup(yield* effective(true)).getEntitySchema(reference)?.pluginId,
					).toBe(installed.pluginId);
					yield* installations.updateHealth({
						health: "incompatible",
						healthReason: "conflict",
						id: installed.installation.id,
					});
					expect(
						definitionLookup(yield* effective(true)).getEntitySchema(reference),
					).toBeUndefined();
					const runtime = yield* PluginRuntimeResolver;
					expect(yield* runtime.listPluginsAvailableToUser(owner, true)).toEqual([]);
				}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect("keeps same-name schema definitions independent across owners", () =>
			Effect.gen(function* () {
				const repository = yield* DefinitionRepository;
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
				const definitions = yield* repository.getUserSnapshot(owner, { listed: false });
				expect(
					definitionLookup(definitions).getEntitySchema({
						slug: "shared-entity",
						owner: definitionOwner(system.pluginId),
					})?.pluginId,
				).toBe(system.pluginId);
				expect(
					definitionLookup(definitions).getEntitySchema({
						slug: "shared-entity",
						owner: definitionOwner(privatePlugin.pluginId),
					})?.pluginId,
				).toBe(privatePlugin.pluginId);
				expect(
					definitionLookup(definitions).getEntitySchema({
						slug: "notes-extra",
						owner: definitionOwner(privatePlugin.pluginId),
					})?.pluginId,
				).toBe(privatePlugin.pluginId);
			}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect("resolves cron and bootstrap declarations against their package revision", () =>
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
					(yield* runtime.resolveActivePluginCron({
						cronSlug: "scheduled",
						pluginId: installed.pluginId,
					}))?.script.pluginRevisionId,
				).toBe(installed.revisionId);
				expect(
					(yield* runtime.resolveActivePluginUserBootstrap({
						pluginId: installed.pluginId,
						bootstrapSlug: "user-startup",
					}))?.script.pluginRevisionId,
				).toBe(installed.revisionId);
				expect(
					(yield* runtime.resolveInstallationBootstrap(installed.installation.id))?.entries,
				).toHaveLength(1);
			}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect("schedules private crons only for ready enabled exact installations", () =>
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
					isHidden: true,
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
		);
	});
	layer(revisionDatabaseLayer)((test) => {
		test.effect(
			"quarantines a private same-name schedule without removing the system schedule",
			() =>
				Effect.gen(function* () {
					const runtime = yield* PluginRuntimeResolver;
					const installations = yield* PluginInstallationRepository;
					const privatePlugin = yield* installRevisionPackage(schedulePackage(), owner);
					const system = yield* installRevisionPackage(schedulePackage());
					expect(
						(yield* runtime.listPrivateCronSchedules()).map(({ installationId }) => installationId),
					).toEqual([privatePlugin.installation.id]);
					expect(
						(yield* runtime.listSystemCronSchedules()).map(({ pluginId }) => pluginId),
					).toEqual([system.pluginId]);
					expect(
						yield* runtime.resolveActivePluginCron({
							cronSlug: "scheduled",
							pluginId: privatePlugin.pluginId,
						}),
					).toBeNull();
					expect(
						yield* runtime.resolvePrivatePluginCron({
							cronSlug: "scheduled",
							installationId: system.installation.id,
						}),
					).toBeNull();
					yield* installations.updateHealth({
						health: "incompatible",
						id: privatePlugin.installation.id,
						healthReason: "Identity conflict",
						incompatibilityReason: "package-identity-conflict",
					});
					expect(yield* runtime.listPrivateCronSchedules()).toEqual([]);
					expect(
						yield* runtime.resolvePrivatePluginCron({
							cronSlug: "scheduled",
							installationId: privatePlugin.installation.id,
						}),
					).toBeNull();
					expect(
						(yield* runtime.resolveActivePluginCron({
							cronSlug: "scheduled",
							pluginId: system.pluginId,
						}))?.script.pluginId,
					).toBe(system.pluginId);
				}),
		);
	});
});

describe("package selection for a user", () => {
	const quarantine = Effect.fn(function* (installationId: string) {
		const installations = yield* PluginInstallationRepository;
		yield* installations.updateHealth({
			id: installationId,
			health: "incompatible",
			healthReason: "Identity conflict",
			incompatibilityReason: "package-identity-conflict",
		});
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect("selects a private installation when it is the only claim", () =>
			Effect.gen(function* () {
				const runtime = yield* PluginRuntimeResolver;
				const packageId = testPluginPackageId();
				const privatePlugin = yield* installRevisionPackage(
					revisionPackage("whiskey", "v1", undefined, packageId),
					owner,
				);
				expect(yield* runtime.resolveUserPackage(owner, packageId)).toEqual({
					kind: "effective",
					pluginId: privatePlugin.pluginId,
				});
				expect(yield* runtime.resolveUserPackage(other, packageId)).toEqual({ kind: "absent" });
			}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect("switches to the system copy when the private copy is quarantined", () =>
			Effect.gen(function* () {
				const runtime = yield* PluginRuntimeResolver;
				const packageId = testPluginPackageId();
				const privatePlugin = yield* installRevisionPackage(
					revisionPackage("whiskey", "private", undefined, packageId),
					owner,
				);
				yield* quarantine(privatePlugin.installation.id);
				const system = yield* installRevisionPackage(
					revisionPackage("whiskey", "system", undefined, packageId),
				);
				expect(yield* runtime.resolveUserPackage(owner, packageId)).toEqual({
					kind: "effective",
					pluginId: system.pluginId,
				});
			}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect("reports a quarantined private copy when nothing else claims the package", () =>
			Effect.gen(function* () {
				const runtime = yield* PluginRuntimeResolver;
				const packageId = testPluginPackageId();
				const privatePlugin = yield* installRevisionPackage(
					revisionPackage("whiskey", "v1", undefined, packageId),
					owner,
				);
				yield* quarantine(privatePlugin.installation.id);
				expect(yield* runtime.resolveUserPackage(owner, packageId)).toEqual({
					kind: "quarantined",
					pluginId: privatePlugin.pluginId,
				});
			}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect(
			"selects a hidden system copy over a quarantined private copy without exposing its operations",
			() =>
				Effect.gen(function* () {
					const runtime = yield* PluginRuntimeResolver;
					const installations = yield* PluginInstallationRepository;
					const packageId = testPluginPackageId();
					const privatePlugin = yield* installRevisionPackage(
						operationPackage("private", packageId),
						owner,
					);
					yield* quarantine(privatePlugin.installation.id);
					const system = yield* installRevisionPackage(operationPackage("system", packageId));
					yield* installations.updateState({
						config: {},
						sortOrder: 0,
						isHidden: true,
						id: system.installation.id,
					});
					expect(yield* runtime.resolveUserPackage(owner, packageId)).toEqual({
						kind: "effective",
						pluginId: system.pluginId,
					});
					expect(
						yield* runtime.findOperationAvailableToUser({
							userId: owner,
							pluginId: system.pluginId,
							operationSlug: "same-operation",
						}),
					).toBeNull();
				}),
		);
	});
});

describe("catalog reads across revision boundaries", () => {
	layer(revisionDatabaseLayer)((test) => {
		test.effect(
			"projects client imports from each selected revision artifact without rebinding captured catalogs",
			() =>
				Effect.gen(function* () {
					const runtime = yield* PluginRuntimeResolver;
					const target = revisionPackage("whiskey");
					const reference = {
						scope: "system" as const,
						packageId: target.manifest.metadata.packageId,
					};
					const targetClient: PluginClientEntry = {
						homeView: null,
						apiVersion: CLIENT_API_VERSION,
						exports: {
							card: {
								kind: "component",
								entry: "client/card.tsx",
								automaticEntityPresentations: false,
							},
							other: {
								kind: "component",
								entry: "client/other.tsx",
								automaticEntityPresentations: false,
							},
						},
					};
					yield* installRevisionPackage(withClient(target, targetClient, []));
					const original = revisionPackage("whiskey");
					const client: PluginClientEntry = {
						homeView: null,
						apiVersion: CLIENT_API_VERSION,
						pluginDependencies: { target: reference },
						exports: {
							home: {
								kind: "component",
								entry: "client/home.tsx",
								automaticEntityPresentations: false,
							},
						},
					};
					const firstImport: PluginClientImport = { reference, exportName: "card" };
					const secondImport: PluginClientImport = { reference, exportName: "other" };
					const installed = yield* installRevisionPackage(
						withClient(original, client, [firstImport]),
					);
					const captured = yield* runtime.findPluginAvailableToUser(owner, installed.pluginId);
					assert(captured);
					expect(captured.clientImports).toEqual([firstImport]);
					const next = revisionPackage(
						"whiskey",
						"v2",
						"whiskey-entity",
						original.manifest.metadata.packageId,
					);
					yield* installRevisionPackage(withClient(next, client, [secondImport]));
					expect(
						(yield* runtime.findPluginAvailableToUser(owner, installed.pluginId))?.clientImports,
					).toEqual([secondImport]);
					expect(captured.clientImports).toEqual([firstImport]);
				}),
		);
	});
	layer(revisionDatabaseLayer)((test) => {
		test.effect("exposes only the catalog sections of the selected revision", () =>
			Effect.gen(function* () {
				const runtime = yield* PluginRuntimeResolver;
				const client: PluginClientEntry = {
					homeView: null,
					apiVersion: CLIENT_API_VERSION,
					exports: {
						home: {
							kind: "component",
							entry: "client/home.tsx",
							automaticEntityPresentations: false,
						},
					},
				};
				const withEntry = withClient(operationPackage("v1"), client, []);
				const withoutEntry = revisionPackage("notes");
				yield* installRevisionPackage(withEntry);
				yield* installRevisionPackage(withoutEntry);
				for (const listed of [false, true]) {
					expect(
						(yield* runtime.listPluginsAvailableToUser(owner, listed)).map(
							({ manifest }) => manifest,
						),
					).toEqual(
						[withEntry, withoutEntry]
							.sort((left, right) =>
								left.manifest.metadata.packageId.localeCompare(right.manifest.metadata.packageId),
							)
							.map(({ manifest }) => ({
								client: manifest.client,
								workflows: manifest.workflows,
								operations: manifest.operations,
								metadata: { name: manifest.metadata.name },
							})),
					);
				}
			}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect("serves the upgraded manifest and the upgraded script rows after a reinstall", () =>
			Effect.gen(function* () {
				const plugins = yield* PluginRepository;
				const runtime = yield* PluginRuntimeResolver;
				const original = revisionPackage("fixture", "v1");
				const first = yield* installRevisionPackage(original);
				const provider = yield* runtime.findSchemaProviderByReference({
					slug: "fixture-provider",
					owner: definitionOwner(first.pluginId),
				});
				assert(provider);
				const firstScript = yield* runtime.resolveDetailsScript(provider.provider.id);
				expect((yield* plugins.listActiveSystemPlugins())[0]?.manifest.metadata.version).toBe("v1");

				const second = yield* installRevisionPackage(
					revisionPackage("fixture", "v2", "fixture-entity", original.manifest.metadata.packageId),
				);
				expect(second.revisionId).not.toBe(first.revisionId);
				expect((yield* plugins.listActiveSystemPlugins())[0]?.manifest.metadata.version).toBe("v2");
				const secondScript = yield* runtime.resolveDetailsScript(provider.provider.id);
				expect(secondScript.id).not.toBe(firstScript.id);
				expect(secondScript.contentHash).toBe("fixture.details-v2");
			}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect(
			"stops resolving a deactivated plugin's provider while its revision stays readable",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const plugins = yield* PluginRepository;
					const runtime = yield* PluginRuntimeResolver;
					const installed = yield* installRevisionPackage(revisionPackage());
					const provider = yield* runtime.findSchemaProviderByReference({
						slug: "fixture-provider",
						owner: definitionOwner(installed.pluginId),
					});
					assert(provider);
					expect((yield* runtime.listPluginsAvailableToUser(owner)).length).toBe(1);

					yield* plugins.deactivate(installed.pluginId);
					const [revision] = yield* session.run((db) =>
						db
							.select({ providers: tables.pluginRevision.providers })
							.from(tables.pluginRevision)
							.where(eq(tables.pluginRevision.id, installed.revisionId)),
					);
					expect(revision?.providers).toHaveLength(1);
					expect(
						yield* runtime.findSchemaProviderByReference({
							slug: "fixture-provider",
							owner: definitionOwner(installed.pluginId),
						}),
					).toBeNull();
					expect(yield* runtime.findActiveProviderById(provider.provider.id)).toBeNull();
					expect(yield* runtime.listPluginsAvailableToUser(owner)).toEqual([]);
				}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect("stops resolving a provider the new active revision no longer declares", () =>
			Effect.gen(function* () {
				const runtime = yield* PluginRuntimeResolver;
				const original = revisionPackage("fixture", "v1");
				const installed = yield* installRevisionPackage(original);
				const provider = yield* runtime.findSchemaProviderByReference({
					slug: "fixture-provider",
					owner: definitionOwner(installed.pluginId),
				});
				assert(provider);

				const upgraded = revisionPackage(
					"fixture",
					"v2",
					"fixture-entity",
					original.manifest.metadata.packageId,
				);
				yield* installRevisionPackage({
					...upgraded,
					scripts: upgraded.scripts.filter(({ metadata }) => metadata.kind !== "provider"),
					manifest: {
						...upgraded.manifest,
						providers: [],
						scripts: upgraded.manifest.scripts.filter(({ kind }) => kind !== "provider"),
					},
				});
				expect(
					yield* runtime.findSchemaProviderByReference({
						slug: "fixture-provider",
						owner: definitionOwner(installed.pluginId),
					}),
				).toBeNull();
				expect(yield* runtime.findActiveProviderById(provider.provider.id)).toBeNull();
			}),
		);
	});
});

describe("provider eligibility", () => {
	const eligibility = Effect.fn(function* (providerId: SandboxProviderId) {
		const session = yield* DatabaseSession;
		const runtime = yield* PluginRuntimeResolver;
		const outcome = (resolved: ReturnType<typeof runtime.resolveDetailsScript>) =>
			resolved.pipe(
				Effect.map(({ slug }) => slug),
				Effect.catchTag("UnsupportedProviderOperationError", ({ reason }) =>
					Effect.succeed(reason),
				),
			);
		const listed = yield* session.run((db) =>
			db
				.select({ id: tables.userSandboxProvider.id })
				.from(tables.userSandboxProvider)
				.where(
					and(
						eq(tables.userSandboxProvider.userId, owner),
						eq(tables.userSandboxProvider.id, providerId),
					),
				),
		);
		const operations = yield* session.run((db) =>
			db
				.select({ operation: tables.userSandboxProviderOperation.operation })
				.from(tables.userSandboxProviderOperation)
				.where(
					and(
						eq(tables.userSandboxProviderOperation.userId, owner),
						eq(tables.userSandboxProviderOperation.providerId, providerId),
					),
				),
		);
		return {
			listed: listed.length === 1,
			operations: operations.map(({ operation }) => operation).sort(),
			details: yield* outcome(runtime.resolveDetailsScript(providerId)),
			active: (yield* runtime.findActiveProviderById(providerId)) !== null,
			userSearch: yield* outcome(runtime.resolveUserSearchScript(owner, providerId)),
		};
	});

	const installProvider = Effect.fn(function* (packageValue = revisionPackage()) {
		const runtime = yield* PluginRuntimeResolver;
		const installed = yield* installRevisionPackage(packageValue);
		const provider = yield* runtime.findSchemaProviderByReference({
			slug: "fixture-provider",
			owner: definitionOwner(installed.pluginId),
		});
		assert(provider);
		return { ...installed, providerId: provider.provider.id };
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect("exposes a declared provider with an effective root and matching scripts", () =>
			Effect.gen(function* () {
				const { providerId } = yield* installProvider();
				expect(yield* eligibility(providerId)).toEqual({
					listed: true,
					active: true,
					details: "fixture.details",
					userSearch: "fixture.search",
					operations: ["details", "search"],
				});
			}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect("withdraws a provider slug removed in the new active revision", () =>
			Effect.gen(function* () {
				const original = revisionPackage("fixture", "v1");
				const { providerId } = yield* installProvider(original);
				const upgraded = revisionPackage(
					"fixture",
					"v2",
					"fixture-entity",
					original.manifest.metadata.packageId,
				);
				yield* installRevisionPackage({
					...upgraded,
					scripts: upgraded.scripts.filter(({ metadata }) => metadata.kind !== "provider"),
					manifest: {
						...upgraded.manifest,
						providers: [],
						scripts: upgraded.manifest.scripts.filter(({ kind }) => kind !== "provider"),
					},
				});
				expect(yield* eligibility(providerId)).toEqual({
					listed: false,
					active: false,
					operations: [],
					details: "inactive_provider",
					userSearch: "inactive_provider",
				});
			}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect("withdraws a provider whose root differs from its declared root", () =>
			Effect.gen(function* () {
				const value = revisionPackage();
				const [entity] = value.manifest.entitySchemas;
				assert(entity);
				const { pluginId, providerId } = yield* installProvider({
					...value,
					manifest: {
						...value.manifest,
						entitySchemas: [entity, { ...entity, slug: "other-entity" }],
					},
				});
				yield* (yield* DatabaseSession).run((db) =>
					db
						.update(tables.sandboxProvider)
						.set({ rootEntitySchemaSlug: "other-entity" })
						.where(eq(tables.sandboxProvider.pluginId, pluginId)),
				);
				expect(yield* eligibility(providerId)).toEqual({
					active: true,
					listed: false,
					operations: [],
					details: "script_unavailable",
					userSearch: "inactive_provider",
				});
			}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect("withdraws a provider whose root entity schema is not effective", () =>
			Effect.gen(function* () {
				const { revisionId, providerId } = yield* installProvider();
				yield* (yield* DatabaseSession).run((db) =>
					db
						.update(tables.definitionEntitySchema)
						.set({ slug: "renamed-entity" })
						.where(eq(tables.definitionEntitySchema.pluginRevisionId, revisionId)),
				);
				expect(yield* eligibility(providerId)).toEqual({
					listed: false,
					active: false,
					operations: [],
					details: "inactive_provider",
					userSearch: "inactive_provider",
				});
			}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect("drops operations whose script kind or provider does not match", () =>
			Effect.gen(function* () {
				const { revisionId, providerId } = yield* installProvider();
				const session = yield* DatabaseSession;
				yield* session.run((db) =>
					db
						.update(tables.sandboxScript)
						.set({ providerId: null })
						.where(
							and(
								eq(tables.sandboxScript.pluginRevisionId, revisionId),
								eq(tables.sandboxScript.slug, "fixture.details"),
							),
						),
				);
				yield* session.run((db) =>
					db
						.update(tables.sandboxScript)
						.set({
							metadata: sql`jsonb_set(${tables.sandboxScript.metadata}, '{kind}', '"script"')`,
						})
						.where(
							and(
								eq(tables.sandboxScript.pluginRevisionId, revisionId),
								eq(tables.sandboxScript.slug, "fixture.search"),
							),
						),
				);
				expect(yield* eligibility(providerId)).toEqual({
					listed: true,
					active: true,
					operations: [],
					details: "script_unavailable",
					userSearch: "script_unavailable",
				});
			}),
		);
	});
});

describe("normalized provider definitions", () => {
	type ProviderRow = {
		readonly id: string;
		readonly slug: string;
		readonly user_id: string;
		readonly plugin_id: string;
		readonly plugin_scope: string;
		readonly root_entity_schema_slug: string;
	};
	type OperationRow = {
		readonly user_id: string;
		readonly plugin_id: string;
		readonly operation: string;
		readonly provider_id: string;
		readonly options_schema: unknown;
	};

	const providerViews = Effect.fn(function* () {
		const session = yield* DatabaseSession;
		return {
			providers: yield* session.run((db) =>
				db.execute<ProviderRow>(
					sql`select user_id, id, plugin_id, slug, plugin_scope, root_entity_schema_slug from user_sandbox_provider`,
					"objects",
				),
			),
			operations: yield* session.run((db) =>
				db.execute<OperationRow>(
					sql`select user_id, provider_id, plugin_id, operation, options_schema from user_sandbox_provider_operation`,
					"objects",
				),
			),
		};
	});

	const seedProviders = Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const installations = yield* PluginInstallationRepository;
		const original = multiProviderPackage("v1", true);
		const multi = yield* installRevisionPackage(original);
		yield* installRevisionPackage(
			multiProviderPackage("v2", false, original.manifest.metadata.packageId),
		);
		const rootless = yield* installRevisionPackage(revisionPackage("rootless"));
		yield* session.run((db) =>
			db
				.update(tables.definitionEntitySchema)
				.set({ slug: "renamed-entity" })
				.where(eq(tables.definitionEntitySchema.pluginRevisionId, rootless.revisionId)),
		);
		const unready = yield* installRevisionPackage(revisionPackage("unready"));
		yield* installations.updateHealth({
			healthReason: null,
			id: unready.installation.id,
			health: "needs-configuration",
		});
		const privatePlugin = yield* installRevisionPackage(revisionPackage("private"), other);
		const providers = yield* session.run((db) =>
			db
				.select({
					id: tables.sandboxProvider.id,
					slug: tables.sandboxProvider.slug,
					pluginId: tables.sandboxProvider.pluginId,
					rootEntitySchemaSlug: tables.sandboxProvider.rootEntitySchemaSlug,
				})
				.from(tables.sandboxProvider),
		);
		const idOf = (slug: string) => {
			const provider = providers.find((row) => row.slug === slug);
			assert(provider);
			return provider.id;
		};
		const slugOf = (id: string) => providers.find((row) => row.id === id)?.slug;
		return { idOf, multi, slugOf, providers, privatePlugin };
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect("exposes declared providers and their mapped operations", () =>
			Effect.gen(function* () {
				const { idOf, multi, slugOf, privatePlugin } = yield* seedProviders;
				const { providers, operations } = yield* providerViews();
				expect(
					providers.sort((left, right) =>
						`${left.user_id}:${left.slug}` < `${right.user_id}:${right.slug}` ? -1 : 1,
					),
				).toEqual([
					{
						user_id: owner,
						slug: "multi-provider",
						plugin_scope: "system",
						plugin_id: multi.pluginId,
						id: idOf("multi-provider"),
						root_entity_schema_slug: "multi-entity",
					},
					{
						user_id: owner,
						slug: "multi-second",
						plugin_scope: "system",
						id: idOf("multi-second"),
						plugin_id: multi.pluginId,
						root_entity_schema_slug: "multi-entity",
					},
					{
						user_id: other,
						plugin_scope: "user",
						slug: "private-provider",
						id: idOf("private-provider"),
						plugin_id: privatePlugin.pluginId,
						root_entity_schema_slug: "private-entity",
					},
				]);
				expect(
					operations
						.map(({ user_id, operation, provider_id, options_schema }) => ({
							options_schema,
							operation: `${user_id}:${slugOf(provider_id)}:${operation}`,
						}))
						.sort((left, right) => (left.operation < right.operation ? -1 : 1)),
				).toEqual([
					{ options_schema: null, operation: "owner:multi-provider:details" },
					{ options_schema: null, operation: "owner:multi-provider:resolve" },
					{ options_schema: { fields: {} }, operation: "owner:multi-provider:search" },
					{ options_schema: null, operation: "owner:multi-provider:search-options" },
					{ options_schema: null, operation: "owner:multi-provider:translate" },
					{ options_schema: null, operation: "owner:multi-second:details" },
					{ options_schema: null, operation: "recipient:private-provider:details" },
					{ options_schema: { fields: {} }, operation: "recipient:private-provider:search" },
				]);
			}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect("shows a private plugin's provider and operations only to its owner", () =>
			Effect.gen(function* () {
				const { privatePlugin } = yield* seedProviders;
				const { providers, operations } = yield* providerViews();
				const usersOf = (
					rows: ReadonlyArray<{ readonly user_id: string; readonly plugin_id: string }>,
				) =>
					rows
						.filter(({ plugin_id }) => plugin_id === privatePlugin.pluginId)
						.map(({ user_id }) => user_id);
				expect(usersOf(providers)).toEqual([other]);
				expect(usersOf(operations)).toEqual([other, other]);
				expect(providers.filter(({ user_id }) => user_id === owner).length).toBe(2);
				expect(operations.filter(({ user_id }) => user_id === owner).length).toBe(6);
			}),
		);
	});

	layer(revisionDatabaseLayer)((test) => {
		test.effect("resolves only providers the active system revision declares", () =>
			Effect.gen(function* () {
				const runtime = yield* PluginRuntimeResolver;
				const { idOf, providers } = yield* seedProviders;
				const active: Array<string> = [];
				const authorized: Array<string> = [];
				for (const provider of providers) {
					const providerId = SandboxProviderId.make(provider.id);
					if (yield* runtime.findActiveProviderById(providerId)) {
						active.push(provider.id);
					}
					if (
						yield* runtime.findAuthorizedSchemaProviderById({
							providerId,
							entitySchema: {
								owner: definitionOwner(provider.pluginId),
								slug: EntitySchemaSlug.make(provider.rootEntitySchemaSlug),
							},
						})
					) {
						authorized.push(provider.id);
					}
				}
				const expected = [
					idOf("multi-provider"),
					idOf("multi-second"),
					idOf("unready-provider"),
				].sort();
				expect(active.sort()).toEqual(expected);
				expect(authorized.sort()).toEqual(expected);
				expect(providers.map(({ slug }) => slug).sort()).toEqual([
					"multi-provider",
					"multi-retired",
					"multi-second",
					"private-provider",
					"rootless-provider",
					"unready-provider",
				]);
			}),
		);
	});
});
