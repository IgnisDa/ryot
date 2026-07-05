import { expect, it } from "@effect/vitest";
import type { PluginManifest } from "@ryot/plugin-kit/manifest";
import { Effect, Exit, Layer } from "effect";
import { assert } from "vitest";

import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import {
	dbRunnerLayer,
	makeRedisService,
	type MockOverrides,
	transactionLayer,
} from "#lib/test-utils/effect";
import { DefinitionRegistry, makeDefinitionRegistry } from "#modules/definition-registry/service";

import { PluginLoader } from "./loader";
import { PluginRepository } from "./repository";
import { handlePluginRegistryInvalidation, PluginIngestionService } from "./service";
import { fixtureManifest, fixturePackageRoot } from "./test-support";
import type { NormalizedPlugin, StoredPlugin } from "./types";

const mockRepository = Layer.mock(PluginRepository);

const makeRepository = (overrides: MockOverrides<typeof mockRepository>) =>
	mockRepository({ _tag: "PluginRepository", ...overrides });

const makeStoredPlugin = (manifest: PluginManifest, sourceHash: string): StoredPlugin => {
	const script = manifest.scripts[0];
	assert(script);
	const { entry, ...metadata } = script;
	return {
		manifest,
		sourceHash,
		status: "active",
		scripts: [
			{
				entry,
				metadata,
				slug: script.slug,
				name: script.name,
				compiledFormat: 1,
				source: "cached source",
				contentHash: "cached-hash",
				compiledCode: "cached compiled",
			},
		],
	};
};

const makeLayer = (input?: {
	readonly cached?: boolean;
	readonly persisted?: Array<NormalizedPlugin>;
	readonly initialInstalled?: ReadonlyArray<StoredPlugin>;
	readonly published?: Array<{ channel: string; message: string }>;
}) => {
	const installed: Array<StoredPlugin> = [...(input?.initialInstalled ?? [])];
	const registry = makeDefinitionRegistry();
	const registryLayer = Layer.succeed(
		DefinitionRegistry,
		Object.assign(registry, { _tag: "DefinitionRegistry" as const }),
	);
	const loaderLayer = PluginLoader.Default.pipe(Layer.provide(registryLayer));
	const repositoryLayer = makeRepository({
		list: () => Effect.succeed(installed),
		lockIngestion: () => Effect.void,
		findBySourceHash: ({ sourceHash }) =>
			Effect.succeed(input?.cached ? makeStoredPlugin(fixtureManifest(), sourceHash) : null),
		persist: (plugin) =>
			Effect.sync(() => {
				input?.persisted?.push(plugin);
				installed.splice(0, installed.length, { ...plugin, status: "active" });
			}),
	});
	const redisLayer = Layer.succeed(
		RedisService,
		makeRedisService({
			publish: (channel, message) =>
				Effect.sync(() => {
					input?.published?.push({ channel, message });
					return 1;
				}),
		}),
	);
	const ingestionLayer = PluginIngestionService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(loaderLayer, redisLayer, repositoryLayer, dbRunnerLayer, transactionLayer),
		),
	);
	return Layer.mergeAll(loaderLayer, ingestionLayer);
};

it.effect("validates, compiles, content-addresses, persists, loads, and publishes", () => {
	const persisted: Array<NormalizedPlugin> = [];
	const published: Array<{ channel: string; message: string }> = [];
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const loader = yield* PluginLoader;
		const plugin = yield* ingestion.ingestPlugin({
			manifest: fixtureManifest(),
			packageRoot: fixturePackageRoot(),
		});

		expect(plugin.sourceHash).toMatch(/^[a-f0-9]{64}$/);
		expect(plugin.scripts[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/);
		expect(persisted).toEqual([plugin]);
		expect(loader.getSnapshot().definitions.entitySchemas["fixture-entity"]?.name).toBe("Fixture");
		expect(loader.getSnapshot().bindings.entityAutomations).toHaveLength(1);
		expect(published).toHaveLength(1);
		expect(published[0]?.channel).toBe(redisKeys.pluginRegistryChannel);
	}).pipe(Effect.provide(makeLayer({ persisted, published })));
});

it.effect("rebuilds the registry when Redis invalidates the plugin snapshot", () => {
	const stored = makeStoredPlugin(fixtureManifest(), "stored-source-hash");
	return Effect.gen(function* () {
		const loader = yield* PluginLoader;
		const ingestion = yield* PluginIngestionService;
		expect(loader.getSnapshot().plugins["fixture"]).toBeUndefined();
		yield* handlePluginRegistryInvalidation(redisKeys.pluginRegistryChannel, ingestion);
		expect(loader.getSnapshot().plugins["fixture"]?.sourceHash).toBe("stored-source-hash");
	}).pipe(Effect.provide(makeLayer({ initialInstalled: [stored] })));
});

it.effect("short-circuits compilation and persistence for a matching source hash", () => {
	const persisted: Array<NormalizedPlugin> = [];
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const loader = yield* PluginLoader;
		const plugin = yield* ingestion.ingestPlugin({
			manifest: fixtureManifest(),
			packageRoot: fixturePackageRoot("diagnostic"),
		});

		expect(plugin.scripts[0]?.compiledCode).toBe("cached compiled");
		expect(persisted).toHaveLength(0);
		expect(loader.getSnapshot().plugins["fixture"]).toBeDefined();
	}).pipe(Effect.provide(makeLayer({ cached: true, persisted })));
});

it.effect("rejects manifest, slash, collision, dangling binding, and compiler failures", () => {
	const cases: ReadonlyArray<{
		manifest: unknown;
		packageRoot: string;
		expectedTag: string;
	}> = [
		{ manifest: {}, packageRoot: fixturePackageRoot(), expectedTag: "PluginValidationError" },
		{
			packageRoot: fixturePackageRoot(),
			expectedTag: "PluginValidationError",
			manifest: {
				...fixtureManifest(),
				metadata: { ...fixtureManifest().metadata, slug: "bad/slug" },
			},
		},
		{
			packageRoot: fixturePackageRoot(),
			expectedTag: "PluginValidationError",
			manifest: {
				...fixtureManifest(),
				entitySchemas: [{ ...fixtureManifest().entitySchemas[0], slug: "movie" }],
			},
		},
		{
			packageRoot: fixturePackageRoot(),
			expectedTag: "PluginValidationError",
			manifest: {
				...fixtureManifest(),
				bindings: {
					...fixtureManifest().bindings,
					entityAutomations: [
						{
							operation: "create",
							scriptSlug: "missing",
							entitySchemaSlug: "fixture-entity",
						},
					],
				},
			},
		},
		{
			manifest: fixtureManifest(),
			expectedTag: "SandboxCompilerFailure",
			packageRoot: fixturePackageRoot("diagnostic"),
		},
	];

	return Effect.forEach(cases, (testCase) =>
		Effect.gen(function* () {
			const ingestion = yield* PluginIngestionService;
			const exit = yield* Effect.exit(
				ingestion.ingestPlugin({
					manifest: testCase.manifest,
					packageRoot: testCase.packageRoot,
				}),
			);
			expect(Exit.isFailure(exit)).toBe(true);
			expect(String(exit)).toContain(testCase.expectedTag);
		}).pipe(Effect.provide(makeLayer())),
	);
});
