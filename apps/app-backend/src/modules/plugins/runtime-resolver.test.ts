import { expect, it } from "@effect/vitest";
import type { PluginManifest } from "@ryot/contract/modules/plugins/manifest";
import { SandboxProviderId, SandboxScriptId } from "@ryot/contract/schema/brands";
import { PgDialect } from "drizzle-orm/pg-core";
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Option } from "effect";
import { assert } from "vitest";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb } from "#lib/infrastructure/db/service";
import { makeDefinitionRegistry } from "#modules/definition-registry/service";

import { makePluginLoader, PluginLoader } from "./loader";
import { PluginRuntimeResolver, UnsupportedProviderOperationError } from "./runtime-resolver";
import { fixtureManifest } from "./test-support";
import type { NormalizedPlugin } from "./types";

const providerId = SandboxProviderId.make("provider-id");

type MockQuery = Promise<ReadonlyArray<unknown>> & {
	limit: () => Promise<ReadonlyArray<unknown>>;
};

const limitable = (rows: ReadonlyArray<unknown>): MockQuery => {
	const promise = Promise.resolve(rows);
	return Object.assign(promise, { limit: () => promise });
};

const normalizedPlugin = (): NormalizedPlugin => {
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
		bindings: manifest.bindings,
		workflows: [{ slug: "fixture-run", scriptSlug: workflow.slug }],
		scripts: [...manifest.scripts, queryScript, details, search, preload, workflow],
		entitySchemas: [...manifest.entitySchemas, { ...fixtureEntitySchema, slug: "unbound-entity" }],
		providers: [
			{
				name: "Fixture provider",
				slug: "fixture-provider",
				information: { source: "fixture" },
				rootEntitySchemaSlug: "fixture-entity",
				operations: { details: details.slug, search: search.slug },
			},
		],
	};
	return {
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

const providerOwnerPlugin = (): NormalizedPlugin => {
	const plugin = normalizedPlugin();
	const entitySchema = plugin.manifest.entitySchemas[0];
	assert(entitySchema);
	return {
		scripts: [],
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
			},
		},
	};
};

const providerRow = {
	id: providerId,
	pluginSlug: "fixture",
	name: "Fixture provider",
	slug: "fixture-provider",
	rootEntitySchemaSlug: "fixture-entity",
	createdAt: new Date(0),
	updatedAt: new Date(0),
	information: { source: "fixture" },
};

const scriptRow = {
	providerId,
	source: "source",
	compiledFormat: 1,
	pluginSlug: "fixture",
	name: "Fixture details",
	slug: "fixture.details",
	compiledCode: "compiled",
	createdAt: new Date(0),
	updatedAt: new Date(0),
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
) => {
	const loader = makePluginLoader(makeDefinitionRegistry());
	const callerPlugin = normalizedPlugin();
	loader.load(
		crossPlugin
			? { ...callerPlugin, manifest: { ...callerPlugin.manifest, providers: [] } }
			: callerPlugin,
	);
	if (crossPlugin) {
		loader.load(providerOwnerPlugin());
	}
	const dialect = new PgDialect();
	const operationScripts = new Map([
		[firstScript.slug.endsWith(".search") ? "search" : "details", firstScript],
	]);
	const sqlParams = (condition: unknown) => {
		const getSQL =
			typeof condition === "object" && condition !== null
				? Reflect.get(condition, "getSQL")
				: undefined;
		return typeof getSQL === "function" ? dialect.sqlToQuery(getSQL.call(condition)).params : [];
	};
	const scriptRows = (condition: unknown) => {
		const params = sqlParams(condition);
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
					innerJoin: () => builder,
					leftJoin: () => builder,
					where: (condition: unknown) => {
						if (table === schema.sandboxProvider) {
							return limitable(storedProvider ? [storedProvider] : []);
						}
						if (table === schema.sandboxProviderOperation) {
							const params = sqlParams(condition);
							const operation = params.find((value) =>
								["details", "search", "resolve", "translate"].includes(String(value)),
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
	return PluginRuntimeResolver.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				Layer.succeed(PluginLoader, { ...loader }),
				Layer.succeed(CurrentDb, Object.assign(Object.create(null), db)),
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
		expect(yield* resolver.listSchemaProviders()).toMatchObject([
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
			provider: { id: providerId, pluginSlug: "fixture" },
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
		expect(
			yield* resolver.resolveSystemQueryScript(SandboxScriptId.make("query-script-id")),
		).toMatchObject({
			pluginSlug: "fixture",
			entitySchemaSlugs: ["fixture-entity", "unbound-entity"],
		});
		expect(
			yield* resolver.resolveSystemQueryScript(SandboxScriptId.make("details-script-id")),
		).toBeNull();
	}).pipe(Effect.provide(makeLayer())),
);

it.effect("resolves provider operations from persisted operation rows", () =>
	Effect.gen(function* () {
		const resolver = yield* PluginRuntimeResolver;
		expect(yield* resolver.resolveSearchScript(providerId)).toMatchObject({
			optionsSchema: null,
			id: "search-script-id",
			slug: "fixture.search",
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
			provider: { id: providerId, pluginSlug: "provider-owner" },
		});
		expect(
			yield* resolver.findAuthorizedSchemaProviderById({
				providerId,
				pluginSlug: "fixture",
				entitySchemaSlug: "foreign-entity",
			}),
		).toBeNull();
	}).pipe(Effect.provide(makeLayer({ ...providerRow, pluginSlug: "provider-owner" }, true))),
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
			providerSlug: "fixture-provider",
			reason: "unsupported_operation",
		});
	}).pipe(Effect.provide(makeLayer())),
);

it.effect(
	"resolves provider operations from one snapshot while registry replacement is pending",
	() =>
		Effect.gen(function* () {
			const selected = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			const runtime = yield* Effect.context();
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
										return Effect.runPromiseWith(runtime)(
											Deferred.succeed(selected, undefined).pipe(
												Effect.andThen(Deferred.await(release)),
											),
										).then(() => [providerRow]);
									}
									return table === schema.sandboxProviderOperation
										? Promise.resolve([{ script: scriptRow }])
										: Promise.resolve([scriptRow]);
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
						Layer.succeed(CurrentDb, Object.assign(Object.create(null), db)),
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
			loader.load({
				...replacement,
				manifest: { ...replacement.manifest, providers: [] },
			});
			yield* Deferred.succeed(release, undefined);
			expect(yield* Fiber.join(fiber)).toMatchObject({
				id: "details-script-id",
				slug: "fixture.details",
			});
			expect(snapshotReads).toBe(1);
		}),
);
