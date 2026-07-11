import { expect, it } from "@effect/vitest";
import { SandboxProviderId, SandboxScriptId } from "@ryot/contract/schema/brands";
import type { PluginManifest } from "@ryot/plugin-kit/manifest";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { assert } from "vitest";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb } from "#lib/infrastructure/db/service";
import { makeDefinitionRegistry } from "#modules/definition-registry/service";

import { makePluginLoader, PluginLoader } from "./loader";
import { PluginRuntimeResolver, UnsupportedProviderOperationError } from "./runtime-resolver";
import { fixtureManifest } from "./test-support";
import type { NormalizedPlugin } from "./types";

const providerId = SandboxProviderId.make("provider-id");

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
	const activity = {
		...automation,
		name: "Fixture activity",
		slug: "fixture.activity",
		kind: "activity" as const,
	};
	const normalizedManifest: PluginManifest = {
		...manifest,
		entitySchemas: [...manifest.entitySchemas, { ...fixtureEntitySchema, slug: "unbound-entity" }],
		workflows: [{ slug: "fixture-run", scriptSlug: workflow.slug }],
		scripts: [...manifest.scripts, activity, details, search, preload, workflow],
		providers: [
			{
				name: "Fixture provider",
				slug: "fixture-provider",
				information: { source: "fixture" },
				operations: { details: details.slug, search: search.slug },
			},
		],
		bindings: {
			...manifest.bindings,
			schemaProviderLinks: [
				{ providerSlug: "fixture-provider", entitySchemaSlug: "fixture-entity" },
			],
		},
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
			entitySchemas: [{ ...entitySchema, slug: "foreign-entity" }],
			metadata: { ...plugin.manifest.metadata, name: "Provider owner", slug: "provider-owner" },
			bindings: {
				eventAutomations: [],
				entityAutomations: [],
				signalAutomations: [],
				relationshipAutomations: [],
				schemaProviderLinks: [
					{ providerSlug: "fixture-provider", entitySchemaSlug: "foreign-entity" },
				],
			},
		},
	};
};

const providerRow = {
	id: providerId,
	name: "Fixture provider",
	slug: "fixture-provider",
	pluginSlug: "fixture",
	createdAt: new Date(0),
	updatedAt: new Date(0),
	information: { source: "fixture" },
};

const scriptRow = {
	name: "Fixture details",
	source: "source",
	pluginSlug: "fixture",
	providerId,
	compiledFormat: 1,
	compiledCode: "compiled",
	createdAt: new Date(0),
	updatedAt: new Date(0),
	id: SandboxScriptId.make("details-script-id"),
	slug: "fixture.details",
	contentHash: "fixture.details-hash",
	metadata: {
		capabilities: [],
		kind: "provider" as const,
		name: "Fixture details",
		slug: "fixture.details",
		requiredAppConfigKeys: [],
	},
};

const customScriptRow = {
	...scriptRow,
	name: "Fixture preload",
	slug: "fixture.preload",
	id: SandboxScriptId.make("preload-script-id"),
	contentHash: "fixture.preload-hash",
	metadata: {
		capabilities: [],
		kind: "script" as const,
		name: "Fixture preload",
		slug: "fixture.preload",
		requiredAppConfigKeys: [],
	},
};

const workflowScriptRow = {
	...scriptRow,
	providerId: null,
	name: "Fixture workflow",
	slug: "fixture.workflow",
	id: SandboxScriptId.make("workflow-script-id"),
	contentHash: "fixture.workflow-hash",
	metadata: {
		capabilities: [],
		kind: "workflow" as const,
		name: "Fixture workflow",
		slug: "fixture.workflow",
		requiredAppConfigKeys: [],
	},
};

const activityScriptRow = {
	...scriptRow,
	providerId: null,
	name: "Fixture activity",
	slug: "fixture.activity",
	contentHash: "fixture.activity-hash",
	id: SandboxScriptId.make("activity-script-id"),
	metadata: {
		capabilities: [],
		name: "Fixture activity",
		slug: "fixture.activity",
		requiredAppConfigKeys: [],
		kind: "activity" as const,
	},
};

const makeLayer = (
	storedProvider: typeof providerRow | null = providerRow,
	crossPlugin = false,
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
	let scriptSelectCount = 0;
	const db = {
		select: () => ({
			from: (table: unknown) => ({
				where: () => ({
					limit: () => {
						if (table === schema.sandboxProvider) {
							return Promise.resolve(storedProvider ? [storedProvider] : []);
						}
						scriptSelectCount += 1;
						if (scriptSelectCount === 3) {
							return Promise.resolve([customScriptRow]);
						}
						if (scriptSelectCount === 4) {
							return Promise.resolve([workflowScriptRow]);
						}
						if (scriptSelectCount === 5) {
							return Promise.resolve([activityScriptRow]);
						}
						return Promise.resolve([scriptRow]);
					},
				}),
			}),
		}),
	};
	return PluginRuntimeResolver.Default.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				Layer.succeed(PluginLoader, { _tag: "PluginLoader", ...loader }),
				Layer.succeed(CurrentDb, Object.assign(Object.create(null), db)),
			),
		),
	);
};

it.effect("resolves active schema providers and their operation-specific scripts", () =>
	Effect.gen(function* () {
		const resolver = yield* PluginRuntimeResolver;
		const schemaProvider = yield* resolver.findSchemaProviderBySlug("fixture-provider");
		expect(schemaProvider).toMatchObject({
			entitySchemaSlug: "fixture-entity",
			provider: { id: providerId, slug: "fixture-provider" },
		});
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
			yield* resolver.resolveSystemQueryActivity(SandboxScriptId.make("activity-script-id")),
		).toMatchObject({
			pluginSlug: "fixture",
			entitySchemaSlugs: ["fixture-entity", "unbound-entity"],
		});
		expect(
			yield* resolver.resolveSystemQueryActivity(SandboxScriptId.make("details-script-id")),
		).toBeNull();
	}).pipe(Effect.provide(makeLayer())),
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
		const error = Option.getOrThrow(Cause.failureOption(exit.cause));
		expect(error).toBeInstanceOf(UnsupportedProviderOperationError);
		expect(error).toMatchObject({
			providerId,
			operation: "translate",
			providerSlug: "fixture-provider",
			reason: "unsupported_operation",
		});
	}).pipe(Effect.provide(makeLayer())),
);
