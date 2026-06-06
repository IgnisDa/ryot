import { BunFileSystem } from "@effect/platform-bun";
import { assert, expect, it } from "@effect/vitest";
import {
	clientPluginCompilationFailure,
	clientPluginCompilerDiagnostic,
} from "@ryot/client-plugin-compiler/diagnostics";
import type { ClientPluginCompilerRequest } from "@ryot/client-plugin-compiler/protocol";
import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	type PluginClientArtifact,
} from "@ryot/contract/modules/plugins/client";
import type { PluginManifest } from "@ryot/contract/modules/plugins/manifest";
import { PluginConflictError } from "@ryot/contract/modules/plugins/schemas";
import { PluginSlug } from "@ryot/contract/schema/brands";
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Option, Queue, Ref } from "effect";

import { Database } from "#lib/infrastructure/db/service";
import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import { assertExitFails } from "#lib/test-utils/assertions";
import { databaseLayer, makeRedisService, type MockOverrides } from "#lib/test-utils/effect";
import { DefinitionRegistry, makeDefinitionRegistry } from "#modules/definition-registry/service";
import { ClientPluginCompiler } from "#modules/plugins/client-plugin-compiler";
import {
	SandboxWorkflowReferenceRegistrationError,
	SandboxWorkflowReferenceRepository,
} from "#modules/sandbox/workflow-reference-repository";

import { PluginLoader } from "./loader";
import { PluginRepository } from "./repository";
import { ScriptGarbageCollector } from "./script-garbage-collector";
import {
	handlePluginRegistryInvalidation,
	PluginIngestionService,
	runPluginRegistryReconciliation,
} from "./service";
import { loadPluginSource } from "./source.test-support";
import { SystemPlugins } from "./system";
import { fixtureManifest, fixturePackageRoot } from "./test-support";
import type { NormalizedPlugin, StoredPlugin } from "./types";

const failureOf = (exit: Exit.Exit<unknown, unknown>) => {
	assert(Exit.isFailure(exit));
	return Option.getOrThrow(Cause.findErrorOption(exit.cause));
};

const mockRepository = Layer.mock(PluginRepository);

const makeRepository = (overrides: MockOverrides<typeof mockRepository>) =>
	mockRepository({ ...overrides });

const makeStoredPlugin = (manifest: PluginManifest, sourceHash: string): StoredPlugin => {
	return {
		manifest,
		sourceHash,
		ownerId: null,
		scope: "system",
		sourceFiles: {},
		status: "active",
		clientArtifact: null,
		clientArtifactHash: null,
		slug: manifest.metadata.slug,
		id: `${manifest.metadata.slug}-plugin-id`,
		scripts: manifest.scripts.map((script) => {
			const { entry, ...metadata } = script;
			return {
				entry,
				metadata,
				slug: script.slug,
				name: script.name,
				compiledFormat: 1,
				source: "cached source",
				compiledCode: "cached compiled",
				contentHash: `cached-hash-${script.slug}`,
			};
		}),
	};
};

const definitionOwnerManifest = (): PluginManifest => {
	const fixture = fixtureManifest();
	const entitySchema = fixture.entitySchemas[0];
	assert(entitySchema);
	return {
		...fixture,
		scripts: [],
		signalSchemas: [],
		relationshipSchemas: [],
		metadata: { ...fixture.metadata, slug: "example", name: "Example" },
		entitySchemas: [{ ...entitySchema, slug: "item", eventSchemas: [] }],
		bindings: {
			eventAutomations: [],
			entityAutomations: [],
			signalAutomations: [],
			relationshipAutomations: [],
			providerEntityImportAutomations: [],
		},
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
			signalAutomations: [],
			relationshipAutomations: [],
			providerEntityImportAutomations: [],
			entityAutomations: [
				{
					entitySchemaSlug,
					operation: "create",
					scriptSlug: fixture.scripts[0]?.slug ?? "fixture.automation",
				},
			],
		},
	};
};

const formatterOwnerManifest = (): PluginManifest => {
	const fixture = fixtureManifest();
	const script = fixture.scripts[0];
	assert(script);
	return {
		...fixture,
		savedViews: [],
		entitySchemas: [],
		signalSchemas: [],
		relationshipSchemas: [],
		scripts: [{ ...script, slug: "formatter-owner.notification" }],
		metadata: { ...fixture.metadata, name: "Formatter owner", slug: "formatter-owner" },
		bindings: {
			eventAutomations: [],
			entityAutomations: [],
			signalAutomations: [],
			relationshipAutomations: [],
			providerEntityImportAutomations: [],
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
		scripts: [{ ...script, slug: "dependent.automation" }],
		entitySchemas: [{ ...entitySchema, slug: "dependent-entity" }],
		metadata: { ...fixture.metadata, name: "Dependent", slug: "dependent" },
		relationshipSchemas: [
			{
				...relationshipSchema,
				slug: "dependent-link",
				targetEntitySchemaSlug,
				sourceEntitySchemaSlug: "dependent-entity",
			},
		],
		bindings: {
			eventAutomations: [],
			entityAutomations: [],
			signalAutomations: [],
			relationshipAutomations: [],
			providerEntityImportAutomations: [],
		},
	};
};

const makeLayer = (input?: {
	readonly cached?: boolean;
	readonly events?: Array<string>;
	readonly deactivated?: Array<string>;
	readonly hasEntityReferences?: boolean;
	readonly cachedManifest?: PluginManifest;
	readonly installed?: Array<StoredPlugin>;
	readonly hasDefinitionReferences?: boolean;
	readonly hasIntegrationReferences?: boolean;
	readonly integrationFences?: Array<unknown>;
	readonly afterPersist?: Effect.Effect<void>;
	readonly persisted?: Array<NormalizedPlugin>;
	readonly databaseLayer?: Layer.Layer<Database>;
	readonly hasWorkflowReferences?: () => boolean;
	readonly systemPluginSlugs?: ReadonlySet<string>;
	readonly publish?: RedisService["Service"]["publish"];
	readonly initialInstalled?: ReadonlyArray<StoredPlugin>;
	readonly repositoryList?: PluginRepository["Service"]["list"];
	readonly deactivate?: PluginRepository["Service"]["deactivate"];
	readonly published?: Array<{ channel: string; message: string }>;
	readonly clientCompile?: ClientPluginCompiler["Service"]["compile"];
	readonly lockIngestion?: PluginRepository["Service"]["lockIngestion"];
	readonly collectGarbage?: ScriptGarbageCollector["Service"]["collect"];
}) => {
	const installed = input?.installed ?? [...(input?.initialInstalled ?? [])];
	const registry = makeDefinitionRegistry();
	const registryLayer = Layer.succeed(DefinitionRegistry, registry);
	const loaderLayer = PluginLoader.layer.pipe(Layer.provide(registryLayer));
	const repositoryLayer = makeRepository({
		list: input?.repositoryList ?? (() => Effect.succeed(installed)),
		deactivate:
			input?.deactivate ??
			((pluginId) =>
				Effect.sync(() => {
					input?.events?.push("deactivate");
					input?.deactivated?.push(pluginId);
					const index = installed.findIndex((plugin) => plugin.id === pluginId);
					if (index >= 0) {
						installed.splice(index, 1);
					}
				})),
		lockIngestion:
			input?.lockIngestion ??
			(() =>
				Effect.sync(() => {
					input?.events?.push("lock");
				})),
		hasEntityReferences: () => Effect.succeed(input?.hasEntityReferences ?? false),
		hasDefinitionReferences: () => Effect.succeed(input?.hasDefinitionReferences ?? false),
		hasIntegrationReferences: (fence) =>
			Effect.sync(() => {
				input?.integrationFences?.push(fence);
				return input?.hasIntegrationReferences ?? false;
			}),
		findBySourceHash: ({ sourceHash }) =>
			Effect.sync(() => {
				if (!input?.cached) {
					return null;
				}
				const cached = makeStoredPlugin(input.cachedManifest ?? fixtureManifest(), sourceHash);
				const index = installed.findIndex(
					(plugin) => plugin.manifest.metadata.slug === cached.manifest.metadata.slug,
				);
				if (index >= 0) {
					installed.splice(index, 1, cached);
				} else {
					installed.push(cached);
				}
				return cached;
			}),
		persist: (plugin, identity) =>
			Effect.gen(function* () {
				const pluginId = `${identity.slug}-plugin-id`;
				yield* Effect.sync(() => {
					input?.persisted?.push(plugin);
					const stored = { ...plugin, ...identity, id: pluginId, status: "active" };
					const index = installed.findIndex((candidate) => candidate.slug === identity.slug);
					if (index >= 0) {
						installed.splice(index, 1, stored);
					} else {
						installed.push(stored);
					}
				});
				if (input?.afterPersist) {
					yield* input.afterPersist;
				}
				return yield* Effect.sync(() => pluginId);
			}),
	});
	const workflowReferenceLayer = Layer.mock(SandboxWorkflowReferenceRepository)({
		hasReferences: () =>
			Effect.sync(() => {
				input?.events?.push("workflow-reference");
				return input?.hasWorkflowReferences?.() ?? false;
			}),
	});
	const testDatabaseLayer = input?.databaseLayer ?? databaseLayer;
	const garbageCollectorLayer = Layer.mock(ScriptGarbageCollector)({
		collect: input?.collectGarbage ?? (() => Effect.sync(() => undefined)),
		recordKernelContentHashes: () => Effect.void,
	});
	const systemPluginsLayer = Layer.succeed(SystemPlugins, {
		sources: [],
		slugs: input?.systemPluginSlugs ?? new Set(),
	});
	const redisLayer = Layer.succeed(
		RedisService,
		makeRedisService({
			publish:
				input?.publish ??
				((channel, message) =>
					Effect.sync(() => {
						input?.events?.push("publish");
						input?.published?.push({ channel, message });
						return 1;
					})),
		}),
	);
	const clientCompilerLayer = Layer.mock(ClientPluginCompiler)(
		input?.clientCompile ? { compile: input.clientCompile } : {},
	);
	const ingestionLayer = PluginIngestionService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				loaderLayer,
				redisLayer,
				repositoryLayer,
				testDatabaseLayer,
				garbageCollectorLayer,
				systemPluginsLayer,
				workflowReferenceLayer,
				clientCompilerLayer,
			),
		),
	);
	return Layer.mergeAll(BunFileSystem.layer, loaderLayer, ingestionLayer, testDatabaseLayer);
};

it.effect("validates, compiles, content-addresses, persists, loads, and publishes", () => {
	const persisted: Array<NormalizedPlugin> = [];
	const published: Array<{ channel: string; message: string }> = [];
	return Effect.gen(function* () {
		const loader = yield* PluginLoader;
		const ingestion = yield* PluginIngestionService;
		const source = yield* loadPluginSource(fixturePackageRoot(), fixtureManifest());
		const plugin = yield* ingestion.ingestSystemPlugin(source);

		expect(plugin.sourceHash).toMatch(/^[a-f0-9]{64}$/);
		expect(plugin.scripts[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/);
		expect(persisted).toEqual([
			{
				clientArtifact: null,
				scripts: plugin.scripts,
				clientArtifactHash: null,
				manifest: plugin.manifest,
				sourceHash: plugin.sourceHash,
				sourceFiles: plugin.sourceFiles,
			},
		]);
		expect(loader.getSnapshot().definitions.entitySchemas["fixture-entity"]?.name).toBe("Fixture");
		expect(loader.getSnapshot().bindings.entityAutomations).toHaveLength(1);
		expect(published).toHaveLength(1);
		expect(published[0]?.channel).toBe(redisKeys.pluginRegistryChannel);
	}).pipe(Effect.provide(makeLayer({ persisted, published })));
});

it.effect("preserves provider search options metadata through ingestion", () => {
	const persisted: Array<NormalizedPlugin> = [];
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const fixture = fixtureManifest();
		const searchOptionsSchema = {
			unknownKeys: "strict" as const,
			fields: {
				passRawQuery: {
					label: "Pass raw query",
					type: "boolean" as const,
					description: "Pass the query without modification",
				},
			},
		};
		const manifest = {
			...fixture,
			providers: [
				{
					name: "Fixture Provider",
					slug: "fixture.provider",
					information: { source: "Fixture" },
					rootEntitySchemaSlug: "fixture-entity",
					operations: { search: "fixture.provider.search", details: "fixture.provider.details" },
				},
			],
			scripts: [
				...fixture.scripts,
				{
					kind: "provider" as const,
					capabilities: [] as const,
					name: "Fixture Provider Details",
					slug: "fixture.provider.details",
					providerSlug: "fixture.provider",
					providerOperation: "details" as const,
					requiredPluginConfigKeys: [] as const,
					requiredSystemConfigKeys: [] as const,
					entry: "scripts/provider-details.sandbox.ts",
				},
				{
					searchOptionsSchema,
					kind: "provider" as const,
					capabilities: [] as const,
					name: "Fixture Provider Search",
					slug: "fixture.provider.search",
					providerSlug: "fixture.provider",
					providerOperation: "search" as const,
					requiredPluginConfigKeys: [] as const,
					requiredSystemConfigKeys: [] as const,
					entry: "scripts/provider-search.sandbox.ts",
				},
			],
		} satisfies PluginManifest;
		const source = yield* loadPluginSource(fixturePackageRoot(), manifest);
		const plugin = yield* ingestion.ingestSystemPlugin(source);
		const searchScript = plugin.scripts.find(({ slug }) => slug === "fixture.provider.search");

		expect(searchScript?.metadata).toMatchObject({ searchOptionsSchema });
		expect(
			persisted[0]?.scripts.find(({ slug }) => slug === "fixture.provider.search")?.metadata,
		).toMatchObject({ searchOptionsSchema });
	}).pipe(Effect.provide(makeLayer({ persisted })));
});

it.effect("returns a committed install when Redis publication fails", () => {
	const persisted: Array<NormalizedPlugin> = [];
	return Effect.gen(function* () {
		const loader = yield* PluginLoader;
		const ingestion = yield* PluginIngestionService;
		const source = yield* loadPluginSource(fixturePackageRoot(), fixtureManifest());
		const plugin = yield* ingestion.ingestSystemPlugin(source);

		expect(persisted).toEqual([
			{
				clientArtifact: null,
				scripts: plugin.scripts,
				clientArtifactHash: null,
				manifest: plugin.manifest,
				sourceHash: plugin.sourceHash,
				sourceFiles: plugin.sourceFiles,
			},
		]);
		expect(loader.getSnapshot().plugins["fixture"]?.sourceHash).toBe(plugin.sourceHash);
	}).pipe(
		Effect.provide(makeLayer({ persisted, publish: () => Effect.die("lost install publication") })),
	);
});

const userBootstrapManifest = () => {
	const manifest = fixtureManifest();
	return {
		...manifest,
		userBootstrap: [
			{
				slug: "fixture",
				scriptSlug: "fixture.user-bootstrap",
				description: "Bootstrap fixture user data",
			},
		],
		scripts: [
			...manifest.scripts,
			{
				kind: "script" as const,
				capabilities: [] as const,
				name: "Fixture User Bootstrap",
				slug: "fixture.user-bootstrap",
				requiredPluginConfigKeys: [] as const,
				requiredSystemConfigKeys: [] as const,
				entry: "scripts/user-bootstrap.sandbox.ts",
			},
		],
	};
};

it.effect("accepts user bootstrap declarations through explicit system ingestion", () => {
	const persisted: Array<NormalizedPlugin> = [];
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const manifest = userBootstrapManifest();
		const source = yield* loadPluginSource(fixturePackageRoot(), {
			...manifest,
			metadata: { ...manifest.metadata, slug: "example" },
		});
		const plugin = yield* ingestion.ingestSystemPlugin(source);

		expect(plugin.manifest.userBootstrap).toEqual([
			{
				slug: "fixture",
				scriptSlug: "fixture.user-bootstrap",
				description: "Bootstrap fixture user data",
			},
		]);
		expect(persisted).toEqual([
			{
				clientArtifact: null,
				scripts: plugin.scripts,
				clientArtifactHash: null,
				manifest: plugin.manifest,
				sourceHash: plugin.sourceHash,
				sourceFiles: plugin.sourceFiles,
			},
		]);
	}).pipe(Effect.provide(makeLayer({ persisted })));
});

it.effect("validates automation bindings against definitions from installed plugins", () => {
	const installedExample = makeStoredPlugin(definitionOwnerManifest(), "example-source-hash");
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		yield* ingestion.rebuild();
		const source = yield* loadPluginSource(fixturePackageRoot(), {
			...fixtureManifest(),
			bindings: {
				...fixtureManifest().bindings,
				entityAutomations: [
					{ operation: "create", entitySchemaSlug: "item", scriptSlug: "fixture.automation" },
				],
			},
		});

		const plugin = yield* ingestion.ingestSystemPlugin(source);
		expect(plugin.manifest.bindings.entityAutomations).toEqual([
			{ operation: "create", entitySchemaSlug: "item", scriptSlug: "fixture.automation" },
		]);
	}).pipe(Effect.provide(makeLayer({ initialInstalled: [installedExample] })));
});

it.effect("accepts plugin-owned and cross-plugin notification formatters", () => {
	const owner = makeStoredPlugin(formatterOwnerManifest(), "formatter-owner-source-hash");
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		yield* ingestion.rebuild();
		const manifest = fixtureManifest();
		const signalSchema = manifest.signalSchemas[0];
		assert(signalSchema);
		const source = yield* loadPluginSource(fixturePackageRoot(), {
			...manifest,
			signalSchemas: [{ ...signalSchema, notificationScriptSlug: "formatter-owner.notification" }],
		});

		const plugin = yield* ingestion.ingestSystemPlugin(source);
		expect(plugin.manifest.signalSchemas[0]?.notificationScriptSlug).toBe(
			"formatter-owner.notification",
		);
	}).pipe(Effect.provide(makeLayer({ initialInstalled: [owner] })));
});

it.effect("rejects plugin signals that reference a kernel source-zero formatter", () => {
	const manifest = fixtureManifest();
	const signalSchema = manifest.signalSchemas[0];
	assert(signalSchema);
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const source = yield* loadPluginSource(fixturePackageRoot(), {
			...manifest,
			signalSchemas: [{ ...signalSchema, notificationScriptSlug: "automation.notification" }],
		});

		const exit = yield* Effect.exit(ingestion.ingestSystemPlugin(source));
		expect(failureOf(exit)).toMatchObject({
			_tag: "PluginRequestError",
			reason: { code: "validation-failed" },
		});
	}).pipe(Effect.provide(makeLayer()));
});

it.effect("rejects missing and non-automation notification formatters", () =>
	Effect.forEach(["missing", "wrong-kind"] as const, (kind) =>
		Effect.gen(function* () {
			const ingestion = yield* PluginIngestionService;
			const manifest = fixtureManifest();
			const signalSchema = manifest.signalSchemas[0];
			const script = manifest.scripts[0];
			assert(signalSchema);
			assert(script);
			const notificationScriptSlug = kind === "missing" ? "missing.notification" : script.slug;
			const source = yield* loadPluginSource(fixturePackageRoot(), {
				...manifest,
				signalSchemas: [{ ...signalSchema, notificationScriptSlug }],
				scripts:
					kind === "wrong-kind" ? [{ ...script, kind: "operation" as const }] : manifest.scripts,
			});

			const exit = yield* Effect.exit(ingestion.ingestSystemPlugin(source));
			expect(failureOf(exit)).toMatchObject({
				_tag: "PluginRequestError",
				reason: { code: "validation-failed" },
			});
		}).pipe(Effect.provide(makeLayer())),
	),
);

it.effect("rejects plugin scripts that collide with kernel source zero", () => {
	const manifest = fixtureManifest();
	const script = manifest.scripts[0];
	assert(script);
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const source = yield* loadPluginSource(fixturePackageRoot(), {
			...manifest,
			scripts: [...manifest.scripts, { ...script, slug: "automation.notification" }],
		});

		const exit = yield* Effect.exit(ingestion.ingestSystemPlugin(source));
		expect(failureOf(exit)).toMatchObject({
			_tag: "PluginRequestError",
			reason: { code: "validation-failed" },
		});
	}).pipe(Effect.provide(makeLayer()));
});

it.effect("rebuilds the registry when Redis invalidates the plugin snapshot", () => {
	const stored = makeStoredPlugin(fixtureManifest(), "stored-source-hash");
	const events: Array<string> = [];
	return Effect.gen(function* () {
		const loader = yield* PluginLoader;
		const ingestion = yield* PluginIngestionService;
		expect(loader.getSnapshot().plugins["fixture"]).toBeUndefined();
		yield* handlePluginRegistryInvalidation(redisKeys.pluginRegistryChannel, ingestion);
		expect(loader.getSnapshot().plugins["fixture"]?.sourceHash).toBe("stored-source-hash");
		expect(events).toEqual(["lock", "collect"]);
	}).pipe(
		Effect.provide(
			makeLayer({
				events,
				initialInstalled: [stored],
				collectGarbage: () =>
					Effect.sync(() => {
						events.push("collect");
						return undefined;
					}),
			}),
		),
	);
});

it.effect("refuses to rebuild a snapshot with a dangling notification formatter", () => {
	const manifest = fixtureManifest();
	const signalSchema = manifest.signalSchemas[0];
	assert(signalSchema);
	const stored = makeStoredPlugin(
		{
			...manifest,
			signalSchemas: [{ ...signalSchema, notificationScriptSlug: "missing.notification" }],
		},
		"stored-source-hash",
	);
	return Effect.gen(function* () {
		const loader = yield* PluginLoader;
		const ingestion = yield* PluginIngestionService;
		const snapshot = loader.getSnapshot();
		const exit = yield* Effect.exit(ingestion.rebuild());

		assert(Exit.isFailure(exit));
		const failure = Cause.findErrorOption(exit.cause);
		assert(Option.isSome(failure));
		assert(failure.value._tag === "PluginValidationError");
		expect(failure.value.issues).toContain(
			"Signal schema fixture.signal notification formatter references missing script: missing.notification",
		);
		expect(loader.getSnapshot()).toBe(snapshot);
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
			const rebuildFiber = yield* Effect.forkChild(ingestion.rebuild());
			yield* Deferred.await(listed);
			const uninstallFiber = yield* Effect.forkChild(ingestion.uninstallPlugin("fixture"));
			yield* Effect.yieldNow;
			expect(deactivated).toEqual([]);
			yield* Deferred.succeed(release, undefined);
			yield* Fiber.join(rebuildFiber);
			yield* Fiber.join(uninstallFiber);
			expect(deactivated).toEqual(["fixture-plugin-id"]);
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
				Effect.andThen(Deferred.await(release)),
			),
		});
		const program = Effect.gen(function* () {
			const loader = yield* PluginLoader;
			const ingestion = yield* PluginIngestionService;
			const source = yield* loadPluginSource(fixturePackageRoot(), fixtureManifest());
			const fiber = yield* Effect.forkChild(ingestion.ingestSystemPlugin(source));
			yield* Deferred.await(persisted);
			fiber.interruptUnsafe();
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
		expect(deactivated).toEqual(["fixture-plugin-id"]);
		expect(loader.getSnapshot().plugins["fixture"]).toBeUndefined();
		expect(published).toEqual([
			expect.objectContaining({ channel: redisKeys.pluginRegistryChannel }),
		]);
	}).pipe(Effect.provide(makeLayer({ deactivated, published, initialInstalled: [stored] })));
});

it.effect("returns a committed uninstall when Redis publication fails", () => {
	const stored = makeStoredPlugin(fixtureManifest(), "stored-source-hash");
	const deactivated: Array<string> = [];
	return Effect.gen(function* () {
		const loader = yield* PluginLoader;
		const ingestion = yield* PluginIngestionService;
		yield* ingestion.rebuild();

		const removed = yield* ingestion.uninstallPlugin("fixture");
		expect(removed.slug).toBe("fixture");
		expect(deactivated).toEqual(["fixture-plugin-id"]);
		expect(loader.getSnapshot().plugins["fixture"]).toBeUndefined();
	}).pipe(
		Effect.provide(
			makeLayer({
				deactivated,
				initialInstalled: [stored],
				publish: () => Effect.die("lost uninstall publication"),
			}),
		),
	);
});

it.effect("periodically rebuilds a peer after lost install and uninstall publications", () =>
	Effect.gen(function* () {
		const installed: Array<StoredPlugin> = [];
		const rebuilds = yield* Queue.unbounded<void>();
		const ticks = yield* Queue.unbounded<void>();
		const writerContext = yield* Layer.build(
			makeLayer({
				installed,
				publish: () => Effect.die("lost publication"),
			}),
		);
		const peerContext = yield* Layer.build(
			makeLayer({
				installed,
				collectGarbage: () => Queue.offer(rebuilds, undefined).pipe(Effect.as(undefined)),
			}),
		);
		const writer = Context.get(writerContext, PluginIngestionService);
		const peer = Context.get(peerContext, PluginIngestionService);
		const peerLoader = Context.get(peerContext, PluginLoader);
		yield* runPluginRegistryReconciliation(Queue.take(ticks), peer).pipe(
			Effect.provide(peerContext),
			Effect.forkScoped,
		);

		const source = yield* loadPluginSource(fixturePackageRoot(), fixtureManifest());
		yield* writer.ingestSystemPlugin(source).pipe(Effect.provide(writerContext));
		expect(peerLoader.getSnapshot().plugins["fixture"]).toBeUndefined();

		yield* Queue.offer(ticks, undefined);
		yield* Queue.take(rebuilds);
		expect(peerLoader.getSnapshot().plugins["fixture"]).toBeDefined();

		yield* writer.uninstallPlugin("fixture").pipe(Effect.provide(writerContext));
		expect(peerLoader.getSnapshot().plugins["fixture"]).toBeDefined();

		yield* Queue.offer(ticks, undefined);
		yield* Queue.take(rebuilds);
		expect(peerLoader.getSnapshot().plugins["fixture"]).toBeUndefined();
	}).pipe(Effect.provide(BunFileSystem.layer)),
);

it.effect("fences uninstall while a queued import workflow references the plugin", () => {
	const stored = makeStoredPlugin(fixtureManifest(), "stored-source-hash");
	const deactivated: Array<string> = [];
	const published: Array<{ channel: string; message: string }> = [];
	const referenceState = { active: true };
	const events: Array<string> = [];
	return Effect.gen(function* () {
		const loader = yield* PluginLoader;
		const ingestion = yield* PluginIngestionService;
		yield* ingestion.rebuild();
		const snapshot = loader.getSnapshot();
		const plugins = yield* ingestion.listPlugins();

		const refused = yield* Effect.exit(ingestion.uninstallPlugin("fixture"));

		assertExitFails(
			refused,
			new PluginConflictError({
				reason: { code: "workflow-referenced", pluginSlug: PluginSlug.make("fixture") },
			}),
		);
		expect(events).toEqual(["lock", "lock", "workflow-reference"]);
		expect(loader.getSnapshot()).toBe(snapshot);
		expect(yield* ingestion.listPlugins()).toEqual(plugins);
		expect(deactivated).toEqual([]);
		expect(published).toEqual([]);

		referenceState.active = false;
		const removed = yield* ingestion.uninstallPlugin("fixture");

		expect(removed.slug).toBe("fixture");
		expect(events).toEqual([
			"lock",
			"lock",
			"workflow-reference",
			"lock",
			"workflow-reference",
			"deactivate",
			"publish",
		]);
		expect(deactivated).toEqual(["fixture-plugin-id"]);
		expect(loader.getSnapshot().plugins["fixture"]).toBeUndefined();
		expect(published).toEqual([
			{
				channel: redisKeys.pluginRegistryChannel,
				message: '{"action":"uninstall","slug":"fixture"}',
			},
		]);
	}).pipe(
		Effect.provide(
			makeLayer({
				events,
				published,
				deactivated,
				initialInstalled: [stored],
				hasWorkflowReferences: () => referenceState.active,
			}),
		),
	);
});

it.effect("serializes workflow pin registration with refused and successful uninstall", () =>
	Effect.forEach([true, false], (hasExistingReference) =>
		Effect.gen(function* () {
			const stored = makeStoredPlugin(fixtureManifest(), "stored-source-hash");
			const exclusiveAcquired = yield* Deferred.make<void>();
			const allowInspection = yield* Deferred.make<void>();
			const exclusiveReleased = yield* Deferred.make<void>();
			const sharedAttempted = yield* Deferred.make<void>();
			const events: string[] = [];
			let active = true;
			let exclusive = false;
			const registerWorkflowReference = Effect.gen(function* () {
				events.push("shared-attempt");
				yield* Deferred.succeed(sharedAttempted, undefined);
				if (exclusive) {
					yield* Deferred.await(exclusiveReleased);
				}
				events.push("shared-acquired");
				if (!active) {
					return yield* new SandboxWorkflowReferenceRegistrationError({
						reason: "plugin-inactive",
						message: "Plugin 'fixture' is not active",
					});
				}
				events.push("registered");
				return { status: "registered" as const };
			});
			const transactionDatabaseLayer = Layer.succeed(
				Database,
				Database.of(
					Object.assign(Object.create(null), {
						transaction: ((callback) =>
							callback(Object.create(null)).pipe(
								Effect.ensuring(
									Effect.suspend(() => {
										if (!exclusive) {
											return Effect.void;
										}
										exclusive = false;
										events.push("exclusive-released");
										return Deferred.succeed(exclusiveReleased, undefined);
									}),
								),
							)) satisfies Database["Service"]["transaction"],
					}),
				),
			);
			const layer = makeLayer({
				events,
				initialInstalled: [stored],
				databaseLayer: transactionDatabaseLayer,
				hasWorkflowReferences: () => hasExistingReference,
				lockIngestion: () =>
					Effect.gen(function* () {
						exclusive = true;
						events.push("exclusive-acquired");
						yield* Deferred.succeed(exclusiveAcquired, undefined);
						yield* Deferred.await(allowInspection);
					}),
				deactivate: () =>
					Effect.sync(() => {
						active = false;
						events.push("deactivated");
					}),
			});

			const program = Effect.gen(function* () {
				const ingestion = yield* PluginIngestionService;
				const uninstall = yield* Effect.forkChild(
					Effect.exit(ingestion.uninstallPlugin("fixture")),
				);
				yield* Deferred.await(exclusiveAcquired);
				expect(events).toEqual(["exclusive-acquired"]);

				const dispatch = yield* Effect.forkChild(Effect.exit(registerWorkflowReference));
				yield* Deferred.await(sharedAttempted);
				expect(events).toEqual(["exclusive-acquired", "shared-attempt"]);

				yield* Deferred.succeed(allowInspection, undefined);
				const uninstallExit = yield* Fiber.join(uninstall);
				const dispatchExit = yield* Fiber.join(dispatch);

				if (hasExistingReference) {
					assertExitFails(
						uninstallExit,
						new PluginConflictError({
							reason: { code: "workflow-referenced", pluginSlug: PluginSlug.make("fixture") },
						}),
					);
					expect(dispatchExit).toEqual(Exit.succeed({ status: "registered" }));
					expect(events).toEqual([
						"exclusive-acquired",
						"shared-attempt",
						"workflow-reference",
						"exclusive-released",
						"shared-acquired",
						"registered",
					]);
				} else {
					expect(Exit.isSuccess(uninstallExit)).toBe(true);
					assertExitFails(
						dispatchExit,
						new SandboxWorkflowReferenceRegistrationError({
							reason: "plugin-inactive",
							message: "Plugin 'fixture' is not active",
						}),
					);
					expect(events).toEqual([
						"exclusive-acquired",
						"shared-attempt",
						"workflow-reference",
						"deactivated",
						"exclusive-released",
						"publish",
						"shared-acquired",
					]);
				}
			});
			yield* program.pipe(Effect.provide(layer));
		}),
	),
);

it.effect("refuses uninstall while entities reference a declared schema", () => {
	const stored = makeStoredPlugin(fixtureManifest(), "stored-source-hash");
	const deactivated: Array<string> = [];
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const exit = yield* Effect.exit(ingestion.uninstallPlugin("fixture"));

		expect(failureOf(exit)).toMatchObject({
			_tag: "PluginConflictError",
			reason: { code: "entity-referenced", pluginSlug: "fixture" },
		});
		expect(deactivated).toEqual([]);
	}).pipe(
		Effect.provide(
			makeLayer({ deactivated, hasEntityReferences: true, initialInstalled: [stored] }),
		),
	);
});

it.effect("refuses uninstall while integrations are owned by the plugin", () => {
	const stored = makeStoredPlugin(fixtureManifest(), "stored-source-hash");
	const deactivated: Array<string> = [];
	const integrationFences: Array<unknown> = [];
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const exit = yield* Effect.exit(ingestion.uninstallPlugin("fixture"));

		assertExitFails(
			exit,
			new PluginConflictError({
				reason: { code: "integration-referenced", pluginSlug: PluginSlug.make("fixture") },
			}),
		);
		expect(integrationFences).toEqual([{ pluginId: stored.id }]);
		expect(deactivated).toEqual([]);
	}).pipe(
		Effect.provide(
			makeLayer({
				deactivated,
				integrationFences,
				initialInstalled: [stored],
				hasIntegrationReferences: true,
			}),
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

		expect(failureOf(exit)).toMatchObject({
			_tag: "PluginConflictError",
			reason: { code: "definition-referenced", pluginSlug: "fixture" },
		});
		expect(deactivated).toEqual([]);
	}).pipe(Effect.provide(makeLayer({ deactivated, initialInstalled: [owner, dependent] })));
});

it.effect("refuses uninstall while another active signal references its formatter", () => {
	const owner = makeStoredPlugin(formatterOwnerManifest(), "formatter-owner-source-hash");
	const manifest = fixtureManifest();
	const signalSchema = manifest.signalSchemas[0];
	assert(signalSchema);
	const dependent = makeStoredPlugin(
		{
			...manifest,
			signalSchemas: [{ ...signalSchema, notificationScriptSlug: "formatter-owner.notification" }],
		},
		"dependent-source-hash",
	);
	const deactivated: Array<string> = [];
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const exit = yield* Effect.exit(ingestion.uninstallPlugin("formatter-owner"));

		expect(failureOf(exit)).toMatchObject({
			_tag: "PluginConflictError",
			reason: { code: "definition-referenced", pluginSlug: "formatter-owner" },
		});
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
			const error = Option.getOrThrow(Cause.findErrorOption(exit.cause));
			expect(error).toMatchObject({
				_tag: "PluginConflictError",
				reason: { code: "definition-referenced", pluginSlug: "fixture" },
			});
		}
		expect(loader.getSnapshot()).toBe(snapshot);
		expect(yield* ingestion.listPlugins()).toEqual(plugins);
		expect(deactivated).toEqual([]);
		expect(published).toEqual([]);
	}).pipe(
		Effect.provide(makeLayer({ deactivated, published, initialInstalled: [owner, dependent] })),
	);
});

it.effect("refuses uninstall for a boot-configured plugin", () => {
	const manifest = definitionOwnerManifest();
	const stored = makeStoredPlugin(manifest, "example-source-hash");
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const exit = yield* Effect.exit(ingestion.uninstallPlugin(manifest.metadata.slug));

		expect(failureOf(exit)).toMatchObject({
			_tag: "PluginConflictError",
			reason: { code: "boot-configured", pluginSlug: "example" },
		});
	}).pipe(
		Effect.provide(
			makeLayer({
				initialInstalled: [stored],
				systemPluginSlugs: new Set([manifest.metadata.slug]),
			}),
		),
	);
});

it.effect("short-circuits compilation and persistence for a matching source hash", () => {
	const events: Array<string> = [];
	const persisted: Array<NormalizedPlugin> = [];
	const published: Array<{ channel: string; message: string }> = [];
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const loader = yield* PluginLoader;
		const source = yield* loadPluginSource(fixturePackageRoot("diagnostic"), fixtureManifest());
		const plugin = yield* ingestion.ingestSystemPlugin(source);

		expect(plugin.scripts[0]?.compiledCode).toBe("cached compiled");
		expect(persisted).toHaveLength(0);
		expect(events).toEqual(["lock", "publish"]);
		expect(loader.getSnapshot().plugins["fixture"]).toBeDefined();
		expect(published).toEqual([
			expect.objectContaining({ channel: redisKeys.pluginRegistryChannel }),
		]);
	}).pipe(Effect.provide(makeLayer({ cached: true, events, persisted, published })));
});

it.effect("validates the full authoritative active set before exposing a cached plugin", () => {
	const cachedManifest: PluginManifest = {
		...fixtureManifest(),
		httpRateLimits: [
			{
				requests: 1,
				intervalMs: 1_000,
				key: "catalog.shared",
				origins: ["https://cached.example.com"],
			},
		],
	};
	const conflictingManifest: PluginManifest = {
		...definitionOwnerManifest(),
		httpRateLimits: [
			{
				requests: 2,
				intervalMs: 1_000,
				key: "catalog.shared",
				origins: ["https://database.example.com"],
			},
		],
	};
	const events: Array<string> = [];
	const published: Array<{ channel: string; message: string }> = [];
	return Effect.gen(function* () {
		const loader = yield* PluginLoader;
		const ingestion = yield* PluginIngestionService;
		const original = loader.getSnapshot();
		const source = yield* loadPluginSource(fixturePackageRoot("diagnostic"), cachedManifest);
		const exit = yield* Effect.exit(ingestion.ingestSystemPlugin(source));

		expect(failureOf(exit)).toMatchObject({
			_tag: "PluginRequestError",
			reason: { code: "validation-failed" },
		});
		expect(events).toEqual(["lock"]);
		expect(loader.getSnapshot()).toBe(original);
		expect(published).toEqual([]);
	}).pipe(
		Effect.provide(
			makeLayer({
				events,
				published,
				cached: true,
				cachedManifest,
				initialInstalled: [makeStoredPlugin(conflictingManifest, "database-source")],
			}),
		),
	);
});

it.effect("returns structured validation and compiler diagnostics", () => {
	const cases: ReadonlyArray<{
		manifest: unknown;
		packageRoot: string;
		reasonCode: "validation-failed" | "compilation-failed";
	}> = [
		{ manifest: {}, packageRoot: fixturePackageRoot(), reasonCode: "validation-failed" },
		{
			reasonCode: "validation-failed",
			packageRoot: fixturePackageRoot(),
			manifest: {
				...fixtureManifest(),
				metadata: { ...fixtureManifest().metadata, slug: "bad/slug" },
			},
		},
		{
			reasonCode: "validation-failed",
			packageRoot: fixturePackageRoot(),
			manifest: {
				...fixtureManifest(),
				entitySchemas: [{ ...fixtureManifest().entitySchemas[0], slug: "item" }],
			},
		},
		{
			reasonCode: "validation-failed",
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
		{
			manifest: fixtureManifest(),
			reasonCode: "compilation-failed",
			packageRoot: fixturePackageRoot("diagnostic"),
		},
	];

	return Effect.forEach(cases, (testCase) =>
		Effect.gen(function* () {
			const ingestion = yield* PluginIngestionService;
			const source = yield* loadPluginSource(testCase.packageRoot, testCase.manifest);
			const exit = yield* Effect.exit(ingestion.ingestSystemPlugin(source));
			const failure = failureOf(exit);
			expect(failure).toMatchObject({
				_tag: "PluginRequestError",
				reason: { code: testCase.reasonCode, diagnostics: expect.any(Array) },
			});
			if (testCase.reasonCode === "compilation-failed") {
				expect(failure).toMatchObject({
					reason: {
						diagnostics: [
							{
								line: 14,
								code: "TS2322",
								phase: "compile",
								severity: "error",
								file: "scripts/fixture.sandbox.ts",
							},
						],
					},
				});
			}
		}).pipe(Effect.provide(makeLayer())),
	);
});

const clientManifest = (): PluginManifest => ({
	...fixtureManifest(),
	client: { entry: "client/index.tsx", apiVersion: CLIENT_API_VERSION, capabilities: [] },
});

const clientArtifact = (): PluginClientArtifact => ({
	format: CLIENT_ARTIFACT_FORMAT,
	apiVersion: CLIENT_API_VERSION,
	compilerVersion: CLIENT_COMPILER_VERSION,
	bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
	hash: "client-artifact-hash",
	files: [
		{ name: "plugin.js", contents: "export {};", contentType: "text/javascript; charset=utf-8" },
		{ name: "index.html", contents: "<!doctype html>", contentType: "text/html; charset=utf-8" },
	],
});

it.effect("compiles the declared client entry and persists its artifact", () => {
	const artifact = clientArtifact();
	const persisted: Array<NormalizedPlugin> = [];
	const requests: Array<ClientPluginCompilerRequest> = [];
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const source = yield* loadPluginSource(fixturePackageRoot(), clientManifest());
		const plugin = yield* ingestion.ingestSystemPlugin(source);

		expect(requests).toEqual([
			{ apiVersion: 1, entry: "client/index.tsx", files: plugin.sourceFiles },
		]);
		expect(persisted).toEqual([
			expect.objectContaining({ clientArtifact: artifact, clientArtifactHash: artifact.hash }),
		]);
	}).pipe(
		Effect.provide(
			makeLayer({
				persisted,
				clientCompile: (request) =>
					Effect.sync(() => {
						requests.push(request);
						return artifact;
					}),
			}),
		),
	);
});

it.effect("fails ingestion without persisting when client compilation fails", () => {
	const persisted: Array<NormalizedPlugin> = [];
	const published: Array<{ channel: string; message: string }> = [];
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const source = yield* loadPluginSource(fixturePackageRoot(), clientManifest());
		const exit = yield* Effect.exit(ingestion.ingestSystemPlugin(source));

		expect(failureOf(exit)).toMatchObject({
			_tag: "PluginRequestError",
			reason: {
				code: "compilation-failed",
				diagnostics: [
					{
						phase: "compile",
						severity: "error",
						file: "client/home.tsx",
						code: "RYOT_CLIENT_IMPORT",
					},
				],
			},
		});
		expect(persisted).toEqual([]);
		expect(published).toEqual([]);
	}).pipe(
		Effect.provide(
			makeLayer({
				persisted,
				published,
				clientCompile: () =>
					Effect.fail(
						clientPluginCompilationFailure([
							clientPluginCompilerDiagnostic(
								"RYOT_CLIENT_IMPORT",
								"client/home.tsx",
								'Import of "effect" is not allowed in client plugin source',
							),
						]),
					),
			}),
		),
	);
});

it.effect("rejects non-canonical and missing plugin source paths as bad requests", () => {
	const manifest = fixtureManifest();
	const entry = manifest.scripts[0]?.entry;
	assert(entry);
	const cases = [
		{ path: "", scriptEntry: entry },
		{ path: "/script.ts", scriptEntry: entry },
		{ path: "scripts\\script.ts", scriptEntry: entry },
		{ path: "scripts//script.ts", scriptEntry: entry },
		{ path: "scripts/./script.ts", scriptEntry: entry },
		{ path: "scripts/../script.ts", scriptEntry: entry },
		{ path: entry, scriptEntry: "scripts/missing.ts" },
	] as const;

	return Effect.forEach(cases, ({ path, scriptEntry }) =>
		Effect.gen(function* () {
			const ingestion = yield* PluginIngestionService;
			const source = yield* loadPluginSource(fixturePackageRoot(), manifest);
			const script = manifest.scripts[0];
			assert(script);
			const exit = yield* Effect.exit(
				ingestion.ingestSystemPlugin({
					files: path === entry ? {} : { ...source.files, [path]: "source" },
					manifest: { ...manifest, scripts: [{ ...script, entry: scriptEntry }] },
				}),
			);
			expect(failureOf(exit)).toMatchObject({
				_tag: "PluginRequestError",
				reason: { code: "validation-failed" },
			});
		}).pipe(Effect.provide(makeLayer())),
	);
});

it.effect("rejects script slug collisions with another active plugin", () => {
	const manifest = fixtureManifest();
	const existingManifest = {
		...manifest,
		metadata: { ...manifest.metadata, slug: "other-plugin" },
	};
	const existing = makeStoredPlugin(existingManifest, "existing-source-hash");
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const source = yield* loadPluginSource(fixturePackageRoot(), fixtureManifest());
		const exit = yield* Effect.exit(ingestion.ingestSystemPlugin(source));
		expect(failureOf(exit)).toMatchObject({
			_tag: "PluginRequestError",
			reason: { code: "validation-failed" },
		});
	}).pipe(Effect.provide(makeLayer({ initialInstalled: [existing] })));
});
