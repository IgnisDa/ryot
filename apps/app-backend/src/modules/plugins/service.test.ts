import { expect, it } from "@effect/vitest";
import { Conflict } from "@ryot/contract/errors";
import type { PluginManifest } from "@ryot/plugin-kit/manifest";
import mediaPlugin from "@ryot/plugin-media";
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Option, Ref } from "effect";
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
import { loadPluginSource } from "./source";
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

const dependentManifest = (entitySchemaSlug: string): PluginManifest => {
	const fixture = fixtureManifest();
	return {
		...fixture,
		entitySchemas: [],
		signalSchemas: [],
		relationshipSchemas: [],
		metadata: { ...fixture.metadata, name: "Dependent", slug: "dependent" },
		bindings: {
			eventAutomations: [],
			entityAutomations: [],
			signalAutomations: [],
			relationshipAutomations: [],
			schemaScriptLinks: [
				{ entitySchemaSlug, scriptSlug: fixture.scripts[0]?.slug ?? "fixture.automation" },
			],
		},
	};
};

const relationshipDependentManifest = (targetEntitySchemaSlug: string): PluginManifest => {
	const fixture = fixtureManifest();
	const entitySchema = fixture.entitySchemas[0];
	const relationshipSchema = fixture.relationshipSchemas[0];
	const script = fixture.scripts[0];
	assert(entitySchema);
	assert(relationshipSchema);
	assert(script);
	return {
		...fixture,
		signalSchemas: [],
		metadata: { ...fixture.metadata, name: "Dependent", slug: "dependent" },
		entitySchemas: [{ ...entitySchema, slug: "dependent-entity" }],
		relationshipSchemas: [
			{
				...relationshipSchema,
				slug: "dependent-link",
				sourceEntitySchemaSlug: "dependent-entity",
				targetEntitySchemaSlug,
			},
		],
		scripts: [{ ...script, slug: "dependent.automation" }],
		bindings: {
			eventAutomations: [],
			entityAutomations: [],
			signalAutomations: [],
			schemaScriptLinks: [],
			relationshipAutomations: [],
		},
	};
};

const makeLayer = (input?: {
	readonly cached?: boolean;
	readonly deactivated?: Array<string>;
	readonly hasEntityReferences?: boolean;
	readonly persisted?: Array<NormalizedPlugin>;
	readonly initialInstalled?: ReadonlyArray<StoredPlugin>;
	readonly published?: Array<{ channel: string; message: string }>;
	readonly afterPersist?: Effect.Effect<void>;
	readonly repositoryList?: PluginRepository["list"];
}) => {
	const installed: Array<StoredPlugin> = [...(input?.initialInstalled ?? [])];
	const registry = makeDefinitionRegistry();
	const registryLayer = Layer.succeed(
		DefinitionRegistry,
		Object.assign(registry, { _tag: "DefinitionRegistry" as const }),
	);
	const loaderLayer = PluginLoader.Default.pipe(Layer.provide(registryLayer));
	const repositoryLayer = makeRepository({
		list: input?.repositoryList ?? (() => Effect.succeed(installed)),
		deactivate: (slug) =>
			Effect.sync(() => {
				input?.deactivated?.push(slug);
				const index = installed.findIndex((plugin) => plugin.manifest.metadata.slug === slug);
				if (index >= 0) {
					installed.splice(index, 1);
				}
			}),
		lockIngestion: () => Effect.void,
		hasEntityReferences: () => Effect.succeed(input?.hasEntityReferences ?? false),
		findBySourceHash: ({ sourceHash }) =>
			Effect.succeed(input?.cached ? makeStoredPlugin(fixtureManifest(), sourceHash) : null),
		persist: (plugin) =>
			Effect.gen(function* () {
				yield* Effect.sync(() => {
					input?.persisted?.push(plugin);
					const index = installed.findIndex(
						(candidate) => candidate.manifest.metadata.slug === plugin.manifest.metadata.slug,
					);
					if (index >= 0) {
						installed.splice(index, 1, { ...plugin, status: "active" });
					} else {
						installed.push({ ...plugin, status: "active" });
					}
				});
				if (input?.afterPersist) {
					yield* input.afterPersist;
				}
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
		const loader = yield* PluginLoader;
		const ingestion = yield* PluginIngestionService;
		const source = yield* loadPluginSource(fixturePackageRoot(), fixtureManifest());
		const plugin = yield* ingestion.ingestPlugin(source);

		expect(plugin.sourceHash).toMatch(/^[a-f0-9]{64}$/);
		expect(plugin.scripts[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/);
		expect(persisted).toEqual([plugin]);
		expect(loader.getSnapshot().definitions.entitySchemas["fixture-entity"]?.name).toBe("Fixture");
		expect(loader.getSnapshot().bindings.entityAutomations).toHaveLength(1);
		expect(published).toHaveLength(1);
		expect(published[0]?.channel).toBe(redisKeys.pluginRegistryChannel);
	}).pipe(Effect.provide(makeLayer({ persisted, published })));
});

it.effect("validates bindings against definitions from installed plugins", () => {
	const installedMedia = makeStoredPlugin(mediaPlugin, "media-source-hash");
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		yield* ingestion.rebuild();
		const source = yield* loadPluginSource(fixturePackageRoot(), {
			...fixtureManifest(),
			bindings: {
				...fixtureManifest().bindings,
				schemaScriptLinks: [{ entitySchemaSlug: "movie", scriptSlug: "fixture.automation" }],
			},
		});

		const plugin = yield* ingestion.ingestPlugin(source);
		expect(plugin.manifest.bindings.schemaScriptLinks).toEqual([
			{ entitySchemaSlug: "movie", scriptSlug: "fixture.automation" },
		]);
	}).pipe(Effect.provide(makeLayer({ initialInstalled: [installedMedia] })));
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

it.effect("serializes rebuild with plugin mutations", () =>
	Effect.gen(function* () {
		const stored = makeStoredPlugin(fixtureManifest(), "stored-source-hash");
		const listed = yield* Deferred.make<void>();
		const release = yield* Deferred.make<void>();
		const calls = yield* Ref.make(0);
		const deactivated: string[] = [];
		const repositoryList = () =>
			Effect.gen(function* () {
				const call = yield* Ref.getAndUpdate(calls, (value) => value + 1);
				if (call === 0) {
					yield* Deferred.succeed(listed, undefined);
					yield* Deferred.await(release);
				}
				return [stored];
			});
		const layer = makeLayer({ deactivated, repositoryList });
		const program = Effect.gen(function* () {
			const ingestion = yield* PluginIngestionService;
			const rebuildFiber = yield* Effect.fork(ingestion.rebuild());
			yield* Deferred.await(listed);
			const uninstallFiber = yield* Effect.fork(ingestion.uninstallPlugin("fixture"));
			yield* Effect.yieldNow();
			expect(deactivated).toEqual([]);
			yield* Deferred.succeed(release, undefined);
			yield* Fiber.join(rebuildFiber);
			yield* Fiber.join(uninstallFiber);
			expect(deactivated).toEqual(["fixture"]);
		});
		yield* program.pipe(Effect.provide(layer));
	}),
);

it.effect("completes the committed loader transition when installation is interrupted", () =>
	Effect.gen(function* () {
		const persisted = yield* Deferred.make<void>();
		const release = yield* Deferred.make<void>();
		const layer = makeLayer({
			afterPersist: Deferred.succeed(persisted, undefined).pipe(
				Effect.zipRight(Deferred.await(release)),
			),
		});
		const program = Effect.gen(function* () {
			const loader = yield* PluginLoader;
			const ingestion = yield* PluginIngestionService;
			const source = yield* loadPluginSource(fixturePackageRoot(), fixtureManifest());
			const fiber = yield* Effect.fork(ingestion.ingestPlugin(source));
			yield* Deferred.await(persisted);
			yield* Fiber.interruptFork(fiber);
			yield* Deferred.succeed(release, undefined);
			yield* Fiber.await(fiber);
			expect(loader.getSnapshot().plugins["fixture"]).toBeDefined();
		});
		yield* program.pipe(Effect.provide(layer));
	}),
);

it.effect("lists active plugins and uninstalls without deleting historical scripts", () => {
	const stored = makeStoredPlugin(fixtureManifest(), "stored-source-hash");
	const deactivated: Array<string> = [];
	const published: Array<{ channel: string; message: string }> = [];
	return Effect.gen(function* () {
		const loader = yield* PluginLoader;
		const ingestion = yield* PluginIngestionService;
		yield* ingestion.rebuild();

		expect(yield* ingestion.listPlugins()).toEqual([expect.objectContaining({ slug: "fixture" })]);
		expect(loader.getSnapshot().plugins["fixture"]).toBeDefined();

		const removed = yield* ingestion.uninstallPlugin("fixture");
		expect(removed.slug).toBe("fixture");
		expect(deactivated).toEqual(["fixture"]);
		expect(loader.getSnapshot().plugins["fixture"]).toBeUndefined();
		expect(published).toEqual([
			expect.objectContaining({ channel: redisKeys.pluginRegistryChannel }),
		]);
	}).pipe(Effect.provide(makeLayer({ deactivated, published, initialInstalled: [stored] })));
});

it.effect("refuses uninstall while entities reference a declared schema", () => {
	const stored = makeStoredPlugin(fixtureManifest(), "stored-source-hash");
	const deactivated: Array<string> = [];
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const exit = yield* Effect.exit(ingestion.uninstallPlugin("fixture"));

		expect(String(exit)).toContain("Conflict");
		expect(String(exit)).toContain("entities reference its schemas");
		expect(deactivated).toEqual([]);
	}).pipe(
		Effect.provide(
			makeLayer({ deactivated, hasEntityReferences: true, initialInstalled: [stored] }),
		),
	);
});

it.effect("refuses uninstall while another active plugin binds to its definitions", () => {
	const owner = makeStoredPlugin(fixtureManifest(), "owner-source-hash");
	const dependent = makeStoredPlugin(dependentManifest("fixture-entity"), "dependent-source-hash");
	const deactivated: Array<string> = [];
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const exit = yield* Effect.exit(ingestion.uninstallPlugin("fixture"));

		expect(String(exit)).toContain("Conflict");
		expect(String(exit)).toContain("active plugin bindings reference its definitions");
		expect(deactivated).toEqual([]);
	}).pipe(Effect.provide(makeLayer({ deactivated, initialInstalled: [owner, dependent] })));
});

it.effect("refuses uninstall while another plugin relationship targets its entity schema", () => {
	const owner = makeStoredPlugin(fixtureManifest(), "owner-source-hash");
	const dependent = makeStoredPlugin(
		relationshipDependentManifest("fixture-entity"),
		"dependent-source-hash",
	);
	const deactivated: Array<string> = [];
	const published: Array<{ channel: string; message: string }> = [];
	return Effect.gen(function* () {
		const loader = yield* PluginLoader;
		const ingestion = yield* PluginIngestionService;
		yield* ingestion.rebuild();
		const snapshot = loader.getSnapshot();
		const plugins = yield* ingestion.listPlugins();

		const exit = yield* Effect.exit(ingestion.uninstallPlugin("fixture"));

		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			const error = Option.getOrThrow(Cause.failureOption(exit.cause));
			expect(error).toBeInstanceOf(Conflict);
		}
		expect(String(exit)).toContain("active plugin schemas reference its definitions");
		expect(loader.getSnapshot()).toBe(snapshot);
		expect(yield* ingestion.listPlugins()).toEqual(plugins);
		expect(deactivated).toEqual([]);
		expect(published).toEqual([]);
	}).pipe(
		Effect.provide(makeLayer({ deactivated, published, initialInstalled: [owner, dependent] })),
	);
});

it.effect("refuses uninstall for a boot-configured plugin", () => {
	const stored = makeStoredPlugin(mediaPlugin, "media-source-hash");
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const exit = yield* Effect.exit(ingestion.uninstallPlugin(mediaPlugin.metadata.slug));

		expect(String(exit)).toContain("Conflict");
		expect(String(exit)).toContain("Boot-configured plugin");
	}).pipe(Effect.provide(makeLayer({ initialInstalled: [stored] })));
});

it.effect("short-circuits compilation and persistence for a matching source hash", () => {
	const persisted: Array<NormalizedPlugin> = [];
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const loader = yield* PluginLoader;
		const source = yield* loadPluginSource(fixturePackageRoot("diagnostic"), fixtureManifest());
		const plugin = yield* ingestion.ingestPlugin(source);

		expect(plugin.scripts[0]?.compiledCode).toBe("cached compiled");
		expect(persisted).toHaveLength(0);
		expect(loader.getSnapshot().plugins["fixture"]).toBeDefined();
	}).pipe(Effect.provide(makeLayer({ cached: true, persisted })));
});

it.effect("rejects manifest, slash, collision, dangling binding, and compiler failures", () => {
	const cases: ReadonlyArray<{
		manifest: unknown;
		packageRoot: string;
	}> = [
		{ manifest: {}, packageRoot: fixturePackageRoot() },
		{
			packageRoot: fixturePackageRoot(),
			manifest: {
				...fixtureManifest(),
				metadata: { ...fixtureManifest().metadata, slug: "bad/slug" },
			},
		},
		{
			packageRoot: fixturePackageRoot(),
			manifest: {
				...fixtureManifest(),
				entitySchemas: [{ ...fixtureManifest().entitySchemas[0], slug: "movie" }],
			},
		},
		{
			packageRoot: fixturePackageRoot(),
			manifest: {
				...fixtureManifest(),
				bindings: {
					...fixtureManifest().bindings,
					entityAutomations: [
						{ operation: "create", scriptSlug: "missing", entitySchemaSlug: "fixture-entity" },
					],
				},
			},
		},
		{ manifest: fixtureManifest(), packageRoot: fixturePackageRoot("diagnostic") },
	];

	return Effect.forEach(cases, (testCase) =>
		Effect.gen(function* () {
			const ingestion = yield* PluginIngestionService;
			const source = yield* loadPluginSource(testCase.packageRoot, testCase.manifest);
			const exit = yield* Effect.exit(ingestion.ingestPlugin(source));
			expect(Exit.isFailure(exit)).toBe(true);
			expect(String(exit)).toContain("BadRequest");
		}).pipe(Effect.provide(makeLayer())),
	);
});

it.effect("rejects non-canonical and missing plugin source paths as bad requests", () => {
	const manifest = fixtureManifest();
	const entry = manifest.scripts[0]?.entry;
	assert(entry);
	const cases = [
		{ path: "", expected: "must not be empty", scriptEntry: entry },
		{ path: "/script.ts", expected: "must be relative", scriptEntry: entry },
		{ path: "scripts\\script.ts", expected: "must use POSIX separators", scriptEntry: entry },
		{ path: "scripts//script.ts", expected: "must not contain empty", scriptEntry: entry },
		{ path: "scripts/./script.ts", expected: "must not contain empty", scriptEntry: entry },
		{ path: "scripts/../script.ts", expected: "must not contain empty", scriptEntry: entry },
		{ path: entry, expected: "is missing from files", scriptEntry: "scripts/missing.ts" },
	] as const;

	return Effect.forEach(cases, ({ expected, path, scriptEntry }) =>
		Effect.gen(function* () {
			const ingestion = yield* PluginIngestionService;
			const source = yield* loadPluginSource(fixturePackageRoot(), manifest);
			const script = manifest.scripts[0];
			assert(script);
			const exit = yield* Effect.exit(
				ingestion.ingestPlugin({
					files: path === entry ? {} : { ...source.files, [path]: "source" },
					manifest: { ...manifest, scripts: [{ ...script, entry: scriptEntry }] },
				}),
			);
			expect(Exit.isFailure(exit)).toBe(true);
			expect(String(exit)).toContain("BadRequest");
			expect(String(exit)).toContain(expected);
		}).pipe(Effect.provide(makeLayer())),
	);
});

it.effect("rejects script slug collisions with another active plugin", () => {
	const existingManifest = fixtureManifest();
	existingManifest.metadata.slug = "other-plugin";
	const existing = makeStoredPlugin(existingManifest, "existing-source-hash");
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const source = yield* loadPluginSource(fixturePackageRoot(), fixtureManifest());
		const exit = yield* Effect.exit(ingestion.ingestPlugin(source));
		expect(Exit.isFailure(exit)).toBe(true);
		expect(String(exit)).toContain("BadRequest");
		expect(String(exit)).toContain("Duplicate script slug 'fixture.automation'");
	}).pipe(Effect.provide(makeLayer({ initialInstalled: [existing] })));
});
