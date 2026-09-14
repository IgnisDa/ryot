import { expect, it } from "@effect/vitest";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import type { SandboxExecutionSubject } from "@ryot-app/contract/modules/sandbox/schemas";
import {
	EntitySchemaSlug,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { PgDialect } from "drizzle-orm/pg-core";
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Option } from "effect";
import { assert } from "vitest";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database } from "#lib/infrastructure/db/service";
import type { SandboxExecutionPrincipal } from "#lib/infrastructure/sandbox-runtime/execution-principal";
import { kernelDefinitionSource } from "#modules/definition-registry/kernel-source";
import { makeDefinitionRegistry } from "#modules/definition-registry/service";

import {
	PluginInstallationRepository,
	type PluginInstallationState,
} from "./installation-repository";
import { makePluginLoader, PluginLoader } from "./loader";
import {
	InvalidProviderEntityImportAutomationError,
	PluginRuntimeResolver,
	UnsupportedProviderOperationError,
} from "./runtime-resolver";
import { fixtureManifest, fixturePluginIdentity } from "./test-support";

const providerId = SandboxProviderId.make("provider-id");

const dialect = new PgDialect();

const sqlParams = (condition: unknown) => {
	const getSQL =
		typeof condition === "object" && condition !== null
			? Reflect.get(condition, "getSQL")
			: undefined;
	return typeof getSQL === "function" ? dialect.sqlToQuery(getSQL.call(condition)).params : [];
};

type MockQuery = Effect.Effect<ReadonlyArray<unknown>> & {
	limit: () => Effect.Effect<ReadonlyArray<unknown>>;
};

const limitable = (rows: ReadonlyArray<unknown>): MockQuery => {
	const effect = Effect.succeed(rows);
	return Object.assign(effect, { limit: () => effect });
};

const normalizedPlugin = (
	providerEntityImportAutomations: PluginManifest["bindings"]["providerEntityImportAutomations"] = [],
) => {
	const manifest = fixtureManifest();
	const automation = manifest.scripts[0];
	const fixtureEntitySchema = manifest.entitySchemas[0];
	assert(automation);
	assert(fixtureEntitySchema);
	const details = {
		...automation,
		name: "Fixture details",
		slug: "fixture.details",
		kind: "provider" as const,
		providerSlug: "fixture-provider",
		providerOperation: "details" as const,
	};
	const search = {
		...automation,
		name: "Fixture search",
		slug: "fixture.search",
		kind: "provider" as const,
		providerSlug: "fixture-provider",
		providerOperation: "search" as const,
	};
	const searchOptions = {
		...automation,
		kind: "provider" as const,
		name: "Fixture search options",
		slug: "fixture.search-options",
		providerSlug: "fixture-provider",
		providerOperation: "search-options" as const,
	};
	const preload = {
		...automation,
		kind: "script" as const,
		name: "Fixture preload",
		slug: "fixture.preload",
		providerSlug: "fixture-provider",
	};
	const workflow = {
		...automation,
		name: "Fixture workflow",
		slug: "fixture.workflow",
		kind: "workflow" as const,
		capabilities: [] as const,
	};
	const queryScript = {
		...automation,
		slug: "fixture.query",
		kind: "script" as const,
		name: "Fixture query script",
	};
	const normalizedManifest: PluginManifest = {
		...manifest,
		workflows: [{ slug: "fixture-run", scriptSlug: workflow.slug }],
		bindings: { ...manifest.bindings, providerEntityImportAutomations },
		scripts: [...manifest.scripts, queryScript, details, search, searchOptions, preload, workflow],
		entitySchemas: [...manifest.entitySchemas, { ...fixtureEntitySchema, slug: "unbound-entity" }],
		providers: [
			{
				name: "Fixture provider",
				slug: "fixture-provider",
				information: { source: "fixture" },
				rootEntitySchemaSlug: "fixture-entity",
				operations: {
					search: search.slug,
					details: details.slug,
					searchOptions: searchOptions.slug,
				},
			},
		],
	};
	return {
		...fixturePluginIdentity(),
		sourceHash: "source-hash",
		manifest: normalizedManifest,
		scripts: normalizedManifest.scripts.map((script) => {
			const { entry, ...metadata } = script;
			return {
				entry,
				metadata,
				source: "source",
				compiledFormat: 1,
				slug: script.slug,
				name: script.name,
				compiledCode: "compiled",
				contentHash: `${script.slug}-hash`,
			};
		}),
	};
};

const providerOwnerPlugin = () => {
	const plugin = normalizedPlugin();
	const entitySchema = plugin.manifest.entitySchemas[0];
	assert(entitySchema);
	return {
		scripts: [],
		...fixturePluginIdentity("provider-owner"),
		sourceHash: "provider-owner-source-hash",
		manifest: {
			...plugin.manifest,
			boot: [],
			crons: [],
			scripts: [],
			workflows: [],
			operations: [],
			savedViews: [],
			signalSchemas: [],
			importSources: [],
			relationshipSchemas: [],
			integrationProviders: [],
			providers: plugin.manifest.providers,
			entitySchemas: [{ ...entitySchema, slug: "foreign-entity" }],
			metadata: { ...plugin.manifest.metadata, name: "Provider owner", slug: "provider-owner" },
			bindings: {
				eventAutomations: [],
				entityAutomations: [],
				signalAutomations: [],
				relationshipAutomations: [],
				providerEntityImportAutomations: [],
			},
		},
	};
};

const providerRow = {
	id: providerId,
	createdAt: new Date(0),
	updatedAt: new Date(0),
	name: "Fixture provider",
	slug: "fixture-provider",
	pluginId: "fixture-plugin-id",
	information: { source: "fixture" },
	rootEntitySchemaSlug: "fixture-entity",
};

const scriptRow = {
	providerId,
	source: "source",
	compiledFormat: 1,
	createdAt: new Date(0),
	updatedAt: new Date(0),
	name: "Fixture details",
	slug: "fixture.details",
	compiledCode: "compiled",
	pluginId: "fixture-plugin-id",
	contentHash: "fixture.details-hash",
	id: SandboxScriptId.make("details-script-id"),
	metadata: {
		capabilities: [],
		name: "Fixture details",
		slug: "fixture.details",
		kind: "provider" as const,
		requiredPluginConfigKeys: [],
		requiredSystemConfigKeys: [],
	},
};

const providerImportScriptRow = {
	...scriptRow,
	name: "Fixture automation",
	slug: "fixture.automation",
	contentHash: "fixture.automation-hash",
	id: SandboxScriptId.make("provider-import-script-id"),
	metadata: {
		...scriptRow.metadata,
		name: "Fixture automation",
		slug: "fixture.automation",
		kind: "automation" as const,
	},
};

const searchScriptRow = {
	...scriptRow,
	name: "Fixture search",
	slug: "fixture.search",
	contentHash: "fixture.search-hash",
	id: SandboxScriptId.make("search-script-id"),
	metadata: {
		capabilities: [],
		name: "Fixture search",
		slug: "fixture.search",
		kind: "provider" as const,
		requiredPluginConfigKeys: [],
		requiredSystemConfigKeys: [],
	},
};

const searchOptionsScriptRow = {
	...searchScriptRow,
	name: "Fixture search options",
	slug: "fixture.search-options",
	contentHash: "fixture.search-options-hash",
	id: SandboxScriptId.make("search-options-script-id"),
	metadata: {
		...searchScriptRow.metadata,
		name: "Fixture search options",
		slug: "fixture.search-options",
		providerOperation: "search-options" as const,
	},
};

const customScriptRow = {
	...scriptRow,
	name: "Fixture preload",
	slug: "fixture.preload",
	contentHash: "fixture.preload-hash",
	id: SandboxScriptId.make("preload-script-id"),
	metadata: {
		capabilities: [],
		kind: "script" as const,
		name: "Fixture preload",
		slug: "fixture.preload",
		requiredPluginConfigKeys: [],
		requiredSystemConfigKeys: [],
	},
};

const workflowScriptRow = {
	...scriptRow,
	providerId: null,
	name: "Fixture workflow",
	slug: "fixture.workflow",
	contentHash: "fixture.workflow-hash",
	id: SandboxScriptId.make("workflow-script-id"),
	metadata: {
		capabilities: [],
		name: "Fixture workflow",
		slug: "fixture.workflow",
		kind: "workflow" as const,
		requiredPluginConfigKeys: [],
		requiredSystemConfigKeys: [],
	},
};

const queryScriptRow = {
	...scriptRow,
	providerId: null,
	slug: "fixture.query",
	name: "Fixture query script",
	contentHash: "fixture.query-hash",
	id: SandboxScriptId.make("query-script-id"),
	metadata: {
		capabilities: [],
		slug: "fixture.query",
		kind: "script" as const,
		name: "Fixture query script",
		requiredPluginConfigKeys: [],
		requiredSystemConfigKeys: [],
	},
};

const makeLayer = (
	storedProvider: typeof providerRow | null = providerRow,
	crossPlugin = false,
	firstScript: typeof scriptRow = scriptRow,
	providerEntityImportAutomations: PluginManifest["bindings"]["providerEntityImportAutomations"] = [],
	installation: Partial<PluginInstallationState> | null = {},
) => {
	const loader = makePluginLoader(makeDefinitionRegistry());
	const callerPlugin = normalizedPlugin(providerEntityImportAutomations);
	loader.load(
		crossPlugin
			? { ...callerPlugin, manifest: { ...callerPlugin.manifest, providers: [] } }
			: callerPlugin,
	);
	if (crossPlugin) {
		loader.load(providerOwnerPlugin());
	}
	const operationScripts = new Map([
		[firstScript.slug.endsWith(".search") ? "search" : "details", firstScript],
		["search-options", searchOptionsScriptRow],
	]);
	const scriptRows = (condition: unknown) => {
		const params = sqlParams(condition);
		if (params.includes("fixture.automation")) {
			return [providerImportScriptRow];
		}
		if (params.includes("fixture.preload")) {
			return [customScriptRow];
		}
		if (params.includes("fixture.workflow")) {
			return [workflowScriptRow];
		}
		if (params.includes("fixture.query") || params.includes("query-script-id")) {
			return [queryScriptRow];
		}
		return params.includes("details-script-id") || params.includes("fixture.details")
			? [scriptRow]
			: [firstScript];
	};
	const db = {
		select: () => ({
			from: (table: unknown) => {
				const builder = {
					leftJoin: () => builder,
					innerJoin: () => builder,
					where: (condition: unknown) => {
						if (table === schema.sandboxProvider) {
							return limitable(storedProvider ? [storedProvider] : []);
						}
						if (table === schema.sandboxProviderOperation) {
							const params = sqlParams(condition);
							const operation = params.find((value) =>
								["details", "search", "search-options", "resolve", "translate"].includes(
									String(value),
								),
							);
							const script = operationScripts.get(String(operation));
							return limitable(script ? [{ script }] : []);
						}
						return limitable(scriptRows(condition));
					},
				};
				return builder;
			},
		}),
	};
	const systemInstallation =
		installation === null
			? null
			: Object.assign(Object.create(null), {
					sortOrder: 0,
					health: "ready",
					userId: "user-1",
					isDisabled: false,
					healthReason: null,
					pluginScope: "system",
					pluginSlug: "fixture",
					id: "system-installation-id",
					pluginId: "fixture-plugin-id",
					config: { apiToken: "installation-token" },
					...installation,
				});
	return PluginRuntimeResolver.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				Layer.succeed(PluginLoader, { ...loader }),
				Layer.mock(PluginInstallationRepository)({
					findByUserAndPlugin: () => Effect.succeed(systemInstallation),
					listForUser: () => Effect.succeed(systemInstallation ? [systemInstallation] : []),
				}),
				Layer.succeed(Database, Object.assign(Object.create(null), db)),
			),
		),
	);
};

it.effect("resolves active schema providers and their operation-specific scripts", () =>
	Effect.gen(function* () {
		const resolver = yield* PluginRuntimeResolver;
		expect(yield* resolver.findActiveProviderById(providerId)).toMatchObject({
			id: providerId,
			slug: "fixture-provider",
		});
		const schemaProvider = yield* resolver.findSchemaProviderBySlug("fixture-provider");
		expect(schemaProvider).toMatchObject({
			entitySchemaSlug: "fixture-entity",
			provider: { id: providerId, slug: "fixture-provider" },
		});
		expect(yield* resolver.listSchemaProviders({ userId: UserId.make("user-1") })).toMatchObject([
			{
				entitySchemaSlug: "fixture-entity",
				provider: { id: providerId, name: "Fixture provider" },
			},
		]);
		expect(
			yield* resolver.findAuthorizedSchemaProviderById({
				providerId,
				pluginSlug: "fixture",
				entitySchemaSlug: "fixture-entity",
			}),
		).toMatchObject({
			entitySchemaSlug: "fixture-entity",
			provider: { id: providerId, pluginId: "fixture-plugin-id" },
		});
		expect(
			yield* resolver.findAuthorizedSchemaProviderById({
				providerId,
				pluginSlug: "foreign",
				entitySchemaSlug: "fixture-entity",
			}),
		).toBeNull();
		expect(
			yield* resolver.findAuthorizedSchemaProviderById({
				providerId,
				pluginSlug: "fixture",
				entitySchemaSlug: "unbound-entity",
			}),
		).toBeNull();
		expect(yield* resolver.findDetailsScript(providerId)).toMatchObject({
			id: "details-script-id",
			slug: "fixture.details",
		});
		expect(yield* resolver.resolveDetailsScript(providerId)).toMatchObject({
			id: "details-script-id",
			slug: "fixture.details",
		});
		expect(yield* resolver.findActiveScript("fixture.preload")).toMatchObject({
			providerId,
			id: "preload-script-id",
			slug: "fixture.preload",
		});
		expect(
			yield* resolver.findActiveWorkflowScript({
				pluginSlug: "fixture",
				workflowSlug: "fixture-run",
			}),
		).toMatchObject({ id: "workflow-script-id", slug: "fixture.workflow" });
	}).pipe(Effect.provide(makeLayer())),
);

it.effect("filters disabled system providers and automations for new user dispatch", () =>
	Effect.gen(function* () {
		const resolver = yield* PluginRuntimeResolver;
		expect(yield* resolver.isSystemProviderAvailableToUser(UserId.make("user-1"), providerId)).toBe(
			false,
		);
		expect(yield* resolver.listSchemaProviders({ userId: UserId.make("user-1") })).toEqual([]);
		expect(
			yield* resolver.listAutomations({
				operation: "create",
				kind: "subscription",
				userId: UserId.make("user-1"),
				target: { kind: "entity_schema", id: EntitySchemaSlug.make("fixture-entity") },
			}),
		).toEqual([]);
	}).pipe(Effect.provide(makeLayer(providerRow, false, scriptRow, [], { isDisabled: true }))),
);

it.effect("resolves provider-import automations in manifest order", () =>
	Effect.gen(function* () {
		const resolver = yield* PluginRuntimeResolver;
		expect(
			yield* resolver.listProviderEntityImportAutomations(
				null,
				EntitySchemaSlug.make("fixture-entity"),
			),
		).toEqual([
			{
				sandboxScriptId: "provider-import-script-id",
				ruleId:
					"binding:fixture-plugin-id:provider_entity_import:fixture-entity:fixture.automation:0",
			},
			{
				sandboxScriptId: "provider-import-script-id",
				ruleId:
					"binding:fixture-plugin-id:provider_entity_import:fixture-entity:fixture.automation:1",
			},
		]);
	}).pipe(
		Effect.provide(
			makeLayer(providerRow, false, scriptRow, [
				{ scriptSlug: "fixture.automation", entitySchemaSlug: "fixture-entity" },
				{ scriptSlug: "fixture.automation", entitySchemaSlug: "fixture-entity" },
			]),
		),
	),
);

it.effect("returns no provider-import automation for an unmatched schema", () =>
	Effect.gen(function* () {
		const resolver = yield* PluginRuntimeResolver;
		expect(
			yield* resolver.listProviderEntityImportAutomations(
				null,
				EntitySchemaSlug.make("unbound-entity"),
			),
		).toEqual([]);
	}).pipe(Effect.provide(makeLayer())),
);

it.effect("rejects invalid provider-import automation bindings", () =>
	Effect.gen(function* () {
		const resolver = yield* PluginRuntimeResolver;
		const missing = yield* Effect.exit(
			resolver.listProviderEntityImportAutomations(null, EntitySchemaSlug.make("fixture-entity")),
		);
		assert(Exit.isFailure(missing));
		expect(String(missing)).toContain(InvalidProviderEntityImportAutomationError.name);
	}).pipe(
		Effect.provide(
			makeLayer(providerRow, false, scriptRow, [
				{ scriptSlug: "fixture.missing", entitySchemaSlug: "fixture-entity" },
			]),
		),
	),
);

it.effect("rejects provider-import bindings that reference a non-automation script", () =>
	Effect.gen(function* () {
		const resolver = yield* PluginRuntimeResolver;
		const result = yield* Effect.exit(
			resolver.listProviderEntityImportAutomations(null, EntitySchemaSlug.make("fixture-entity")),
		);
		assert(Exit.isFailure(result));
		const error = Option.getOrThrow(Cause.findErrorOption(result.cause));
		expect(error).toMatchObject({ reason: "wrong_script_kind" });
	}).pipe(
		Effect.provide(
			makeLayer(providerRow, false, scriptRow, [
				{ scriptSlug: "fixture.details", entitySchemaSlug: "fixture-entity" },
			]),
		),
	),
);

it.effect("resolves provider operations from persisted operation rows", () =>
	Effect.gen(function* () {
		const resolver = yield* PluginRuntimeResolver;
		expect(yield* resolver.resolveSearchScript(providerId)).toMatchObject({
			optionsSchema: null,
			id: "search-script-id",
			slug: "fixture.search",
		});
		expect(yield* resolver.resolveSearchOptionsScript(providerId)).toMatchObject({
			id: "search-options-script-id",
			slug: "fixture.search-options",
		});
	}).pipe(Effect.provide(makeLayer(providerRow, false, searchScriptRow))),
);

it.effect("rejects provider operations absent from the operation table", () =>
	Effect.gen(function* () {
		const resolver = yield* PluginRuntimeResolver;
		const exit = yield* Effect.exit(resolver.resolveTranslateScript(providerId));
		expect(Exit.isFailure(exit)).toBe(true);
	}).pipe(Effect.provide(makeLayer())),
);

it.effect("rejects provider operations for an inactive provider", () =>
	Effect.gen(function* () {
		const resolver = yield* PluginRuntimeResolver;
		const exit = yield* Effect.exit(resolver.resolveSearchScript(providerId));
		expect(Exit.isFailure(exit)).toBe(true);
	}).pipe(Effect.provide(makeLayer(null))),
);

it.effect("rejects an inactive provider owned by the caller plugin", () =>
	Effect.gen(function* () {
		const resolver = yield* PluginRuntimeResolver;
		expect(
			yield* resolver.findAuthorizedSchemaProviderById({
				providerId,
				pluginSlug: "fixture",
				entitySchemaSlug: "fixture-entity",
			}),
		).toBeNull();
	}).pipe(Effect.provide(makeLayer({ ...providerRow, slug: "inactive-provider" }))),
);

it.effect("authorizes an active cross-plugin provider with an exact registry binding", () =>
	Effect.gen(function* () {
		const resolver = yield* PluginRuntimeResolver;
		expect(
			yield* resolver.findAuthorizedSchemaProviderById({
				providerId,
				pluginSlug: "fixture",
				entitySchemaSlug: "fixture-entity",
			}),
		).toMatchObject({
			entitySchemaSlug: "fixture-entity",
			provider: { id: providerId, pluginId: "provider-owner-plugin-id" },
		});
		expect(
			yield* resolver.findAuthorizedSchemaProviderById({
				providerId,
				pluginSlug: "fixture",
				entitySchemaSlug: "foreign-entity",
			}),
		).toBeNull();
	}).pipe(
		Effect.provide(makeLayer({ ...providerRow, pluginId: "provider-owner-plugin-id" }, true)),
	),
);

it.effect("rejects an unknown provider", () =>
	Effect.gen(function* () {
		const resolver = yield* PluginRuntimeResolver;
		expect(
			yield* resolver.findAuthorizedSchemaProviderById({
				providerId,
				pluginSlug: "fixture",
				entitySchemaSlug: "fixture-entity",
			}),
		).toBeNull();
	}).pipe(Effect.provide(makeLayer(null))),
);

it.effect("returns a contextual typed failure for an unsupported operation", () =>
	Effect.gen(function* () {
		const resolver = yield* PluginRuntimeResolver;
		const exit = yield* Effect.exit(resolver.resolveTranslateScript(providerId));
		assert(Exit.isFailure(exit));
		const error = Option.getOrThrow(Cause.findErrorOption(exit.cause));
		expect(error).toBeInstanceOf(UnsupportedProviderOperationError);
		expect(error).toMatchObject({
			providerId,
			operation: "translate",
			reason: "unsupported_operation",
			providerSlug: "fixture-provider",
		});
	}).pipe(Effect.provide(makeLayer())),
);

it.effect(
	"resolves provider operations from one snapshot while registry replacement is pending",
	() =>
		Effect.gen(function* () {
			const selected = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			const loader = makePluginLoader(makeDefinitionRegistry());
			loader.load(normalizedPlugin());
			let snapshotReads = 0;
			const countedLoader = {
				...loader,
				getSnapshot: () => {
					snapshotReads += 1;
					return loader.getSnapshot();
				},
			};
			const db = {
				select: () => ({
					from: (table: unknown) => {
						const builder = {
							leftJoin: () => builder,
							innerJoin: () => builder,
							where: () => ({
								limit: () => {
									if (table === schema.sandboxProvider) {
										return Effect.gen(function* () {
											yield* Deferred.succeed(selected, undefined);
											yield* Deferred.await(release);
											return [providerRow];
										});
									}
									return table === schema.sandboxProviderOperation
										? Effect.succeed([{ script: scriptRow }])
										: Effect.succeed([scriptRow]);
								},
							}),
						};
						return builder;
					},
				}),
			};
			const layer = PluginRuntimeResolver.layer.pipe(
				Layer.provideMerge(
					Layer.mergeAll(
						Layer.succeed(PluginLoader, countedLoader),
						Layer.mock(PluginInstallationRepository)({
							findByUserAndPlugin: () => Effect.succeed(null),
						}),
						Layer.succeed(Database, Object.assign(Object.create(null), db)),
					),
				),
			);
			const fiber = yield* Effect.forkChild(
				Effect.gen(function* () {
					const resolver = yield* PluginRuntimeResolver;
					return yield* resolver.resolveDetailsScript(providerId);
				}).pipe(Effect.provide(layer)),
			);
			yield* Deferred.await(selected);
			const replacement = normalizedPlugin();
			loader.load({ ...replacement, manifest: { ...replacement.manifest, providers: [] } });
			yield* Deferred.succeed(release, undefined);
			expect(yield* Fiber.join(fiber)).toMatchObject({
				id: "details-script-id",
				slug: "fixture.details",
			});
			expect(snapshotReads).toBe(1);
		}),
);

const privatePluginRow = {
	scope: "user",
	slug: "private",
	ownerId: "user-1",
	id: "private-plugin-id",
	compiledHashes: { "private.script": "private-hash" },
	manifest: {
		...fixtureManifest(),
		operations: [
			{ auth: "user", slug: "private.op", description: "Private", scriptSlug: "private.script" },
		],
		configSchema: {
			unknownKeys: "strict",
			fields: { apiToken: { type: "string", label: "Token", description: "Token" } },
		},
		scripts: [
			...fixtureManifest().scripts,
			{
				capabilities: [],
				name: "Private script",
				slug: "private.script",
				kind: "operation" as const,
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
				entry: "backend/automations/private.sandbox.ts",
			},
		],
	},
};

const privateScriptRow = {
	providerId: null,
	source: "source",
	compiledFormat: 1,
	name: "Private script",
	slug: "private.script",
	createdAt: new Date(0),
	updatedAt: new Date(0),
	compiledCode: "compiled",
	contentHash: "private-hash",
	pluginId: "private-plugin-id",
	id: SandboxScriptId.make("private-script-id"),
	metadata: {
		capabilities: [],
		slug: "private.script",
		name: "Private script",
		kind: "operation" as const,
		requiredPluginConfigKeys: [],
		requiredSystemConfigKeys: [],
	},
};

const privateInstallation = {
	sortOrder: 0,
	health: "ready",
	userId: "user-1",
	isDisabled: false,
	healthReason: null,
	id: "installation-id",
	pluginId: "private-plugin-id",
	config: { apiToken: "private-token" },
};

const makePrivateLayer = (
	installation: Partial<typeof privateInstallation> | null = privateInstallation,
	pluginRow: typeof privatePluginRow | null = privatePluginRow,
) => {
	const loader = makePluginLoader(makeDefinitionRegistry());
	loader.load(normalizedPlugin());
	const db = {
		select: () => ({
			from: (table: unknown) => {
				const builder = {
					leftJoin: () => builder,
					innerJoin: () => builder,
					where: (condition: unknown) => {
						const params = sqlParams(condition);
						if (table === schema.plugin) {
							const owned =
								(!params.includes("user") || params.includes(privatePluginRow.ownerId)) &&
								!params.includes("other-plugin-id");
							return limitable(pluginRow && owned ? [pluginRow] : []);
						}
						return limitable(
							params.includes("private-script-id") || params.includes("private-hash")
								? [privateScriptRow]
								: [],
						);
					},
				};
				return builder;
			},
		}),
	};
	return PluginRuntimeResolver.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				Layer.succeed(PluginLoader, { ...loader }),
				Layer.succeed(Database, Object.assign(Object.create(null), db)),
				Layer.mock(PluginInstallationRepository)({
					findByUserAndPlugin: () =>
						Effect.succeed(
							installation
								? Object.assign(Object.create(null), { ...privateInstallation, ...installation })
								: null,
						),
				}),
			),
		),
	);
};

it.effect("does not resolve a colliding private script slug from another plugin", () =>
	Effect.gen(function* () {
		const resolver = yield* PluginRuntimeResolver;
		expect(
			yield* resolver.findScriptAvailableToUser(
				UserId.make("user-1"),
				"private-plugin-id",
				"private.script",
			),
		).toMatchObject({ id: "private-script-id", pluginId: "private-plugin-id" });
		expect(
			yield* resolver.findScriptAvailableToUser(
				UserId.make("user-1"),
				"other-plugin-id",
				"private.script",
			),
		).toBeNull();
	}).pipe(Effect.provide(makePrivateLayer())),
);

it.effect("resolves a private plugin script that is absent from the system snapshot", () =>
	Effect.gen(function* () {
		const resolver = yield* PluginRuntimeResolver;
		expect(
			yield* resolver.findActiveScriptById(SandboxScriptId.make("private-script-id")),
		).toMatchObject({ pluginSlug: "private", slug: "private.script", id: "private-script-id" });
	}).pipe(Effect.provide(makePrivateLayer())),
);

it.effect("does not resolve a script whose owning plugin is inactive", () =>
	Effect.gen(function* () {
		const resolver = yield* PluginRuntimeResolver;
		expect(
			yield* resolver.findActiveScriptById(SandboxScriptId.make("private-script-id")),
		).toBeNull();
	}).pipe(Effect.provide(makePrivateLayer(privateInstallation, null))),
);

it.effect("does not resolve a private script whose compiled hash is stale", () =>
	Effect.gen(function* () {
		const resolver = yield* PluginRuntimeResolver;
		expect(
			yield* resolver.findActiveScriptById(SandboxScriptId.make("private-script-id")),
		).toBeNull();
	}).pipe(
		Effect.provide(
			makePrivateLayer(privateInstallation, {
				...privatePluginRow,
				compiledHashes: { "private.script": "stale-hash" },
			}),
		),
	),
);

const configPrincipal = (
	subject: SandboxExecutionSubject,
	pluginScope: "system" | "user",
): SandboxExecutionPrincipal => ({
	subject,
	providerId: null,
	contentHash: "script-hash",
	metadata: { kind: "script" },
	scriptSlug: pluginScope === "user" ? "private.script" : "fixture.details",
	scriptId: SandboxScriptId.make(
		pluginScope === "user" ? "private-script-id" : "details-script-id",
	),
	pluginRevision: {
		scope: pluginScope,
		compiledHashes: {},
		workflowScripts: {},
		userBootstrapScriptSlugs: [],
		configSchema: fixtureManifest().configSchema,
		slug: pluginScope === "user" ? "private" : "fixture",
		ownerId: pluginScope === "user" ? UserId.make("user-1") : null,
		id: pluginScope === "user" ? "private-plugin-id" : "fixture-plugin-id",
		schemaScope: { eventSchemas: [], entitySchemaSlugs: [], relationshipSchemaSlugs: [] },
	},
});

const resolvePrivateConfigContext = (subject: SandboxExecutionSubject) =>
	Effect.flatMap(PluginRuntimeResolver, (runtime) =>
		runtime.resolvePluginConfigContext(configPrincipal(subject, "user")),
	);

it.effect(
	"resolves system plugin config from the environment even when an installation stores config",
	() =>
		Effect.gen(function* () {
			const resolver = yield* PluginRuntimeResolver;
			const context = yield* resolver.resolvePluginConfigContext(
				configPrincipal({ type: "system" }, "system"),
			);
			expect(context).toMatchObject({ kind: "environment", pluginSlug: "fixture" });
			expect(context).not.toHaveProperty("config");

			expect(
				yield* resolver.resolvePluginConfigContext(
					configPrincipal({ type: "user", userId: UserId.make("user-1") }, "system"),
				),
			).toMatchObject({ kind: "environment", pluginSlug: "fixture" });
		}).pipe(Effect.provide(makeLayer())),
);

it.effect("resolves private plugin config from the owner's installation", () =>
	Effect.gen(function* () {
		const resolver = yield* PluginRuntimeResolver;
		expect(
			yield* resolver.resolvePluginConfigContext(
				configPrincipal({ type: "user", userId: UserId.make("user-1") }, "user"),
			),
		).toMatchObject({ kind: "installation", config: { apiToken: "private-token" } });
	}).pipe(Effect.provide(makePrivateLayer())),
);

it.effect("keeps exact-owner config available to already-pinned executions", () =>
	Effect.gen(function* () {
		expect(
			yield* resolvePrivateConfigContext({ type: "user", userId: UserId.make("user-1") }).pipe(
				Effect.provide(makePrivateLayer({ isDisabled: true })),
			),
		).toMatchObject({ kind: "installation", config: { apiToken: "private-token" } });
		expect(
			yield* resolvePrivateConfigContext({ type: "user", userId: UserId.make("user-1") }).pipe(
				Effect.provide(makePrivateLayer({ health: "needs-configuration" })),
			),
		).toMatchObject({ kind: "installation", config: { apiToken: "private-token" } });
		expect(
			yield* Effect.flatMap(PluginRuntimeResolver, (resolver) =>
				resolver.resolvePluginConfigContext(
					configPrincipal({ type: "user", userId: UserId.make("user-1") }, "system"),
				),
			).pipe(Effect.provide(makeLayer(providerRow, false, scriptRow, [], { isDisabled: true }))),
		).toMatchObject({ kind: "environment", pluginSlug: "fixture" });
		expect(
			yield* Effect.flatMap(PluginRuntimeResolver, (resolver) =>
				resolver.resolvePluginConfigContext(
					configPrincipal({ type: "user", userId: UserId.make("user-1") }, "system"),
				),
			).pipe(Effect.provide(makeLayer(providerRow, false, scriptRow, [], null))),
		).toBeNull();
	}),
);

it.effect("rejects private plugin config for system, foreign, and uninstalled subjects", () =>
	Effect.gen(function* () {
		expect(
			yield* resolvePrivateConfigContext({ type: "system" }).pipe(
				Effect.provide(makePrivateLayer()),
			),
		).toBeNull();
		expect(
			yield* resolvePrivateConfigContext({ type: "user", userId: UserId.make("user-2") }).pipe(
				Effect.provide(makePrivateLayer()),
			),
		).toBeNull();
		expect(
			yield* resolvePrivateConfigContext({ type: "user", userId: UserId.make("user-1") }).pipe(
				Effect.provide(makePrivateLayer(null)),
			),
		).toBeNull();
	}),
);

const storedPrivatePlugin = { ...privatePluginRow, status: "active" };

const installationState = (overrides: Partial<PluginInstallationState> = {}) =>
	Object.assign(Object.create(null), {
		config: {},
		sortOrder: 0,
		health: "ready",
		userId: "user-1",
		isDisabled: false,
		healthReason: null,
		homeSavedViewId: null,
		pluginScope: "system",
		pluginSlug: "fixture",
		id: "system-installation-id",
		pluginId: "fixture-plugin-id",
		...overrides,
	});

const privateInstallationState = (overrides: Partial<PluginInstallationState> = {}) =>
	installationState({
		pluginScope: "user",
		pluginSlug: "private",
		id: "private-installation-id",
		pluginId: "private-plugin-id",
		config: { apiToken: "private-token" },
		...overrides,
	});

const makeAvailabilityLayer = (
	states: ReadonlyArray<PluginInstallationState>,
	stored: typeof storedPrivatePlugin | null = storedPrivatePlugin,
) => {
	const loader = makePluginLoader(makeDefinitionRegistry());
	loader.load(normalizedPlugin());
	const pluginQueryParams: Array<ReadonlyArray<unknown>> = [];
	const db = {
		select: () => ({
			from: (table: unknown) => ({
				where: (condition: unknown) => {
					const params = sqlParams(condition);
					if (table !== schema.plugin) {
						return limitable(params.includes("private-hash") ? [privateScriptRow] : []);
					}
					pluginQueryParams.push(params);
					const matches =
						stored !== null &&
						params.includes(stored.scope) &&
						params.includes(stored.status) &&
						params.includes(stored.ownerId);
					return limitable(matches ? [stored] : []);
				},
			}),
		}),
	};
	const layer = PluginRuntimeResolver.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				Layer.succeed(PluginLoader, { ...loader }),
				Layer.succeed(Database, Object.assign(Object.create(null), db)),
				Layer.mock(PluginInstallationRepository)({
					listForUser: () => Effect.succeed([...states]),
				}),
			),
		),
	);
	return { layer, pluginQueryParams };
};

it.effect("returns system and owned private plugins with ready enabled installations", () => {
	const { layer, pluginQueryParams } = makeAvailabilityLayer([
		installationState(),
		privateInstallationState(),
	]);
	return Effect.gen(function* () {
		const resolver = yield* PluginRuntimeResolver;
		expect(yield* resolver.listPluginsAvailableToUser(UserId.make("user-1"))).toMatchObject([
			{
				config: {},
				slug: "fixture",
				scope: "system",
				id: "fixture-plugin-id",
				installationId: "system-installation-id",
				compiledHashes: { "fixture.workflow": "fixture.workflow-hash" },
			},
			{
				scope: "user",
				slug: "private",
				id: "private-plugin-id",
				config: { apiToken: "private-token" },
				installationId: "private-installation-id",
				compiledHashes: { "private.script": "private-hash" },
			},
		]);
		expect(pluginQueryParams).toEqual([["user", "active", "user-1"]]);
		expect(
			yield* resolver.findPluginAvailableToUser(UserId.make("user-1"), "private-plugin-id"),
		).toMatchObject({ scope: "user", installationId: "private-installation-id" });
		expect(
			yield* resolver.findOperationAvailableToUser({
				pluginSlug: "private",
				operationSlug: "private.op",
				userId: UserId.make("user-1"),
			}),
		).toMatchObject({
			operation: { slug: "private.op" },
			plugin: { scope: "user", id: "private-plugin-id" },
			script: { slug: "private.script", id: "private-script-id" },
		});
	}).pipe(Effect.provide(layer));
});

it.effect("excludes plugins whose installation is unhealthy or disabled", () =>
	Effect.forEach(
		[
			{ health: "failed" },
			{ health: "installing" },
			{ health: "incompatible" },
			{ health: "needs-configuration" },
			{ isDisabled: true },
		] as ReadonlyArray<Partial<PluginInstallationState>>,
		(overrides) =>
			Effect.gen(function* () {
				const resolver = yield* PluginRuntimeResolver;
				expect(yield* resolver.listPluginsAvailableToUser(UserId.make("user-1"))).toEqual([]);
				expect(
					yield* resolver.findOperationAvailableToUser({
						pluginSlug: "private",
						operationSlug: "private.op",
						userId: UserId.make("user-1"),
					}),
				).toBeNull();
			}).pipe(
				Effect.provide(
					makeAvailabilityLayer([installationState(overrides), privateInstallationState(overrides)])
						.layer,
				),
			),
	),
);

it.effect("excludes a private plugin owned by another user or no longer active", () =>
	Effect.gen(function* () {
		const owned = yield* Effect.flatMap(PluginRuntimeResolver, (resolver) =>
			resolver.listPluginsAvailableToUser(UserId.make("user-2")),
		).pipe(
			Effect.provide(
				makeAvailabilityLayer([installationState(), privateInstallationState()]).layer,
			),
		);
		expect(owned).toMatchObject([{ slug: "fixture", scope: "system" }]);

		const archived = yield* Effect.flatMap(PluginRuntimeResolver, (resolver) =>
			resolver.listPluginsAvailableToUser(UserId.make("user-1")),
		).pipe(
			Effect.provide(
				makeAvailabilityLayer([installationState(), privateInstallationState()], {
					...storedPrivatePlugin,
					status: "archived",
				}).layer,
			),
		);
		expect(archived).toMatchObject([{ slug: "fixture", scope: "system" }]);
	}),
);

const noteManifest = () => {
	const base = fixtureManifest();
	const script = base.scripts[0];
	const entitySchema = base.entitySchemas[0];
	assert(script && entitySchema);
	return {
		...base,
		savedViews: [],
		signalSchemas: [],
		relationshipSchemas: [],
		metadata: { ...base.metadata, name: "Notes", slug: "notes" },
		entitySchemas: [{ ...entitySchema, name: "Note", slug: "note" }],
		scripts: [{ ...script, name: "Notes automation", slug: "notes.automation" }],
		crons: [
			{
				slug: "notes-cron",
				description: "Notes cron",
				scriptSlug: "notes.automation",
				schedule: { cron: "* * * * *" },
			},
		],
		bindings: {
			eventAutomations: [],
			signalAutomations: [],
			relationshipAutomations: [],
			providerEntityImportAutomations: [],
			entityAutomations: [
				{ operation: "create", entitySchemaSlug: "note", scriptSlug: "notes.automation" },
			],
		},
	} satisfies PluginManifest;
};

const emptyBindings = {
	eventAutomations: [],
	entityAutomations: [],
	signalAutomations: [],
	relationshipAutomations: [],
	providerEntityImportAutomations: [],
} satisfies PluginManifest["bindings"];

const shippedNotesPlugin = () => {
	const base = noteManifest();
	return {
		scripts: [],
		...fixturePluginIdentity("shipped-notes"),
		sourceHash: "shipped-notes-source-hash",
		manifest: {
			...base,
			crons: [],
			scripts: [],
			bindings: emptyBindings,
			metadata: { ...base.metadata, name: "Shipped Notes", slug: "shipped-notes" },
		},
	};
};

const collidingNotesManifest = () => {
	const base = noteManifest();
	const entitySchema = base.entitySchemas[0];
	const savedView = kernelDefinitionSource().savedViews[0];
	assert(entitySchema && savedView);
	assert(savedView.renderer.kind === "kernel");
	return {
		...base,
		crons: [],
		scripts: [],
		bindings: emptyBindings,
		entitySchemas: [entitySchema, { ...entitySchema, name: "Task", slug: "task" }],
		savedViews: [
			{ ...savedView, slug: "all-tasks", name: "All Tasks", renderer: savedView.renderer },
			{ ...savedView, slug: "retired", name: "Retired", renderer: savedView.renderer },
		],
	} satisfies PluginManifest;
};

const notePluginRow = (
	pluginId: string,
	ownerId: string,
	manifest: PluginManifest = noteManifest(),
) => ({
	ownerId,
	manifest,
	id: pluginId,
	slug: "notes",
	scope: "user",
	status: "active",
	compiledHashes: { "notes.automation": `${pluginId}-hash` },
});

const noteScriptRow = (pluginId: string) => ({
	pluginId,
	source: "source",
	providerId: null,
	compiledFormat: 1,
	createdAt: new Date(0),
	updatedAt: new Date(0),
	compiledCode: "compiled",
	name: "Notes automation",
	slug: "notes.automation",
	contentHash: `${pluginId}-hash`,
	id: SandboxScriptId.make(`${pluginId}-script-id`),
	metadata: {
		capabilities: [],
		slug: "notes.automation",
		name: "Notes automation",
		kind: "automation" as const,
		requiredPluginConfigKeys: [],
		requiredSystemConfigKeys: [],
	},
});

const noteInstallation = (
	pluginId: string,
	userId: string,
	overrides: Partial<PluginInstallationState> = {},
) =>
	installationState({
		userId,
		pluginId,
		pluginSlug: "notes",
		pluginScope: "user",
		id: `${pluginId}-installation-id`,
		...overrides,
	});

const makeNotesLayer = (
	installations: ReadonlyArray<PluginInstallationState>,
	plugins: ReadonlyArray<ReturnType<typeof notePluginRow>>,
	shipped?: ReturnType<typeof shippedNotesPlugin>,
) => {
	const loader = makePluginLoader(makeDefinitionRegistry());
	if (shipped) {
		loader.load(shipped);
	}
	const readyInstallations = installations.filter(
		(state) => state.health === "ready" && !state.isDisabled,
	);
	const db = {
		select: () => ({
			from: (table: unknown) => {
				const builder = {
					innerJoin: () => builder,
					where: (condition: unknown) => {
						const params = sqlParams(condition);
						if (table === schema.plugin) {
							return limitable(plugins.filter((plugin) => params.includes(plugin.ownerId)));
						}
						if (table === schema.pluginInstallation) {
							// The fake executor cannot evaluate SQL, so assert the private-cron gate is
							// still expressed in the query rather than only in this fixture's filtering.
							expect(params).toEqual(expect.arrayContaining(["user", "active", "ready", false]));
							const scoped = params.find((value) =>
								installations.some((state) => state.id === value),
							);
							return limitable(
								readyInstallations
									.filter((state) => scoped === undefined || state.id === scoped)
									.flatMap((state) => {
										const plugin = plugins.find(({ id }) => id === state.pluginId);
										return plugin
											? [
													{
														pluginId: plugin.id,
														userId: state.userId,
														pluginSlug: plugin.slug,
														installationId: state.id,
														manifest: plugin.manifest,
														compiledHashes: plugin.compiledHashes,
													},
												]
											: [];
									}),
							);
						}
						return limitable(
							plugins
								.filter(
									(plugin) => params.includes(plugin.id) && params.includes(`${plugin.id}-hash`),
								)
								.map((plugin) => noteScriptRow(plugin.id)),
						);
					},
				};
				return builder;
			},
		}),
	};
	return PluginRuntimeResolver.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				Layer.succeed(PluginLoader, { ...loader }),
				Layer.succeed(Database, Object.assign(Object.create(null), db)),
				Layer.mock(PluginInstallationRepository)({
					listForUser: (userId) =>
						Effect.succeed(installations.filter((state) => state.userId === userId)),
				}),
			),
		),
	);
};

const noteAutomations = (userId: string) =>
	Effect.flatMap(PluginRuntimeResolver, (resolver) =>
		resolver.listAutomations({
			operation: "create",
			kind: "subscription",
			userId: UserId.make(userId),
			target: { kind: "entity_schema", id: EntitySchemaSlug.make("note") },
		}),
	);

it.effect("qualifies same-slug private automation bindings by their owning plugin", () => {
	const layer = makeNotesLayer(
		[noteInstallation("notes-a", "user-1"), noteInstallation("notes-b", "user-2")],
		[notePluginRow("notes-a", "user-1"), notePluginRow("notes-b", "user-2")],
	);

	return Effect.gen(function* () {
		const resolver = yield* PluginRuntimeResolver;
		const first = yield* noteAutomations("user-1");
		const second = yield* noteAutomations("user-2");
		expect(first).toMatchObject([
			{
				sandboxScriptId: "notes-a-script-id",
				id: "binding:notes-a:subscription:entity_schema:note:create:notes.automation",
			},
		]);
		expect(second).toMatchObject([
			{
				sandboxScriptId: "notes-b-script-id",
				id: "binding:notes-b:subscription:entity_schema:note:create:notes.automation",
			},
		]);
		const ruleId = first[0]?.id;
		assert(ruleId);
		expect(yield* resolver.findAutomation(UserId.make("user-1"), ruleId)).toMatchObject({
			sandboxScriptId: "notes-a-script-id",
		});
		expect(yield* resolver.findAutomation(UserId.make("user-2"), ruleId)).toBeNull();
	}).pipe(Effect.provide(layer));
});

it.effect("drops private automation bindings from unavailable installations", () =>
	Effect.forEach(
		[{ isDisabled: true }, { health: "installing" }, { health: "failed" }] as ReadonlyArray<
			Partial<PluginInstallationState>
		>,
		(overrides) =>
			Effect.gen(function* () {
				expect(yield* noteAutomations("user-1")).toEqual([]);
			}).pipe(
				Effect.provide(
					makeNotesLayer(
						[noteInstallation("notes-a", "user-1", overrides)],
						[notePluginRow("notes-a", "user-1")],
					),
				),
			),
	),
);

it.effect("includes an installing private plugin only in unavailable definition snapshots", () => {
	const layer = makeNotesLayer(
		[noteInstallation("notes-a", "user-1", { health: "installing" })],
		[notePluginRow("notes-a", "user-1")],
	);

	return Effect.gen(function* () {
		const resolver = yield* PluginRuntimeResolver;
		const definitions = yield* resolver.getEffectiveDefinitions(UserId.make("user-1"));
		const unavailable = yield* resolver.getEffectiveDefinitions(UserId.make("user-1"), true);
		expect(definitions.entitySchemas["note"]).toBeUndefined();
		expect(unavailable.entitySchemas["note"]).toMatchObject({ pluginId: "notes-a" });
		expect(yield* resolver.listPluginsAvailableToUser(UserId.make("user-1"))).toEqual([]);
	}).pipe(Effect.provide(layer));
});

it.effect("materializes private cron schedules per ready enabled installation", () => {
	const layer = makeNotesLayer(
		[
			noteInstallation("notes-a", "user-1"),
			noteInstallation("notes-b", "user-2", { isDisabled: true }),
		],
		[notePluginRow("notes-a", "user-1"), notePluginRow("notes-b", "user-2")],
	);

	return Effect.gen(function* () {
		const resolver = yield* PluginRuntimeResolver;
		expect(yield* resolver.listPrivateCronSchedules()).toMatchObject([
			{
				userId: "user-1",
				pluginId: "notes-a",
				pluginSlug: "notes",
				cron: { slug: "notes-cron" },
				installationId: "notes-a-installation-id",
			},
		]);
		expect(
			yield* resolver.resolvePrivatePluginCron({
				cronSlug: "notes-cron",
				installationId: "notes-a-installation-id",
			}),
		).toMatchObject({
			userId: "user-1",
			pluginSlug: "notes",
			cron: { slug: "notes-cron" },
			script: { id: "notes-a-script-id" },
		});
		expect(
			yield* resolver.resolvePrivatePluginCron({
				cronSlug: "notes-cron",
				installationId: "notes-b-installation-id",
			}),
		).toBeNull();
	}).pipe(Effect.provide(layer));
});

it.effect("lets a shipped definition win a private slug collision while the rest composes", () => {
	const installations = [
		noteInstallation("notes-a", "user-1", { isDisabled: true }),
		installationState({
			pluginSlug: "shipped-notes",
			id: "shipped-installation-id",
			pluginId: "shipped-notes-plugin-id",
		}),
	];
	const layer = makeNotesLayer(
		installations,
		[notePluginRow("notes-a", "user-1", collidingNotesManifest())],
		shippedNotesPlugin(),
	);

	return Effect.gen(function* () {
		const resolver = yield* PluginRuntimeResolver;
		const definitions = yield* resolver.getEffectiveDefinitions(UserId.make("user-1"), true);
		expect(definitions.entitySchemas["note"]).toMatchObject({
			pluginId: "shipped-notes-plugin-id",
		});
		expect(definitions.entitySchemas["task"]).toMatchObject({ pluginId: "notes-a" });
		expect(definitions.savedViews["all-tasks"]).toMatchObject({ pluginId: "notes-a" });
		expect(definitions.savedViews["retired"]).toMatchObject({ pluginId: "notes-a" });
		installations[0] = noteInstallation("notes-a", "user-1", { health: "incompatible" });
		const conflicted = yield* resolver.getEffectiveDefinitions(UserId.make("user-1"), true);
		expect(conflicted.entitySchemas["note"]).toMatchObject({ pluginId: "shipped-notes-plugin-id" });
		expect(conflicted.entitySchemas["task"]).toBeUndefined();
		expect(conflicted.savedViews["all-tasks"]).toBeUndefined();
	}).pipe(Effect.provide(layer));
});

it.effect("resolves effective definitions from current installation state on every call", () => {
	const installations = [noteInstallation("notes-a", "user-1")];
	const layer = makeNotesLayer(installations, [notePluginRow("notes-a", "user-1")]);

	return Effect.gen(function* () {
		const resolver = yield* PluginRuntimeResolver;
		const before = yield* resolver.getEffectiveDefinitions(UserId.make("user-1"));
		expect(before.entitySchemas["note"]).toMatchObject({ pluginId: "notes-a" });
		installations[0] = noteInstallation("notes-a", "user-1", { isDisabled: true });
		const after = yield* resolver.getEffectiveDefinitions(UserId.make("user-1"));
		expect(after.entitySchemas["note"]).toBeUndefined();
	}).pipe(Effect.provide(layer));
});

const danglingReferencesManifest = () => {
	const base = noteManifest();
	return {
		...base,
		relationshipSchemas: [
			{
				name: "Notes Link",
				slug: "notes-link",
				targetEntitySchemaSlug: null,
				propertiesSchema: { fields: {} },
				sourceEntitySchemaSlug: "missing-entity",
			},
		],
		signalSchemas: [
			{
				slug: "notes.signal",
				name: "Notes Signal",
				catalogState: "active",
				propertiesSchema: { fields: {} },
				notificationScriptSlug: "notes.automation",
				audiencePolicy: {
					kind: "related_users",
					subjectSide: "source",
					relationshipSchemaSlug: "notes-link",
				},
			},
		],
	} satisfies PluginManifest;
};

it.effect("drops private definitions referencing a definition no surviving plugin declares", () => {
	const layer = makeNotesLayer(
		[noteInstallation("notes-a", "user-1")],
		[notePluginRow("notes-a", "user-1", danglingReferencesManifest())],
	);

	return Effect.gen(function* () {
		const resolver = yield* PluginRuntimeResolver;
		const definitions = yield* resolver.getEffectiveDefinitions(UserId.make("user-1"));
		expect(definitions.entitySchemas["note"]).toMatchObject({ pluginId: "notes-a" });
		expect(definitions.signalSchemas["notes.signal"]).toBeUndefined();
		expect(definitions.relationshipSchemas["notes-link"]).toBeUndefined();
	}).pipe(Effect.provide(layer));
});
