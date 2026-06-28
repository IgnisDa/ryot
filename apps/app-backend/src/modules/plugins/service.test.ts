import { expect, it } from "@effect/vitest";
import { Conflict } from "@ryot/contract/errors";
import type { PluginManifest } from "@ryot/plugin-kit/manifest";
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Option, Queue, Ref } from "effect";
import { assert } from "vitest";

import { CurrentDb, TransactionRunner } from "#lib/infrastructure/db/service";
import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import { assertExitFails } from "#lib/test-utils/assertions";
import {
	dbRunnerLayer,
	makeRedisService,
	type MockOverrides,
	transactionLayer,
} from "#lib/test-utils/effect";
import { DefinitionRegistry, makeDefinitionRegistry } from "#modules/definition-registry/service";
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
import { loadPluginSource } from "./source";
import { fixtureManifest, fixturePackageRoot } from "./test-support";
import type { NormalizedPlugin, StoredPlugin } from "./types";

const mockRepository = Layer.mock(PluginRepository);

const makeRepository = (overrides: MockOverrides<typeof mockRepository>) =>
	mockRepository({ _tag: "PluginRepository", ...overrides });

const makeStoredPlugin = (manifest: PluginManifest, sourceHash: string): StoredPlugin => {
	return {
		manifest,
		sourceHash,
		status: "active",
		scripts: manifest.scripts.map((script) => {
			const { entry, ...metadata } = script;
			return {
				entry,
				slug: script.slug,
				name: script.name,
				compiledFormat: 1,
				source: "cached source",
				compiledCode: "cached compiled",
				contentHash: `cached-hash-${script.slug}`,
				metadata,
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
		metadata: { ...fixture.metadata, slug: "media", name: "Media" },
		entitySchemas: [{ ...entitySchema, slug: "movie", eventSchemas: [] }],
		bindings: {
			eventAutomations: [],
			entityAutomations: [],
			signalAutomations: [],
			schemaProviderLinks: [],
			relationshipAutomations: [],
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
			schemaProviderLinks: [],
			entityAutomations: [
				{
					operation: "create",
					entitySchemaSlug,
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
			schemaProviderLinks: [],
			relationshipAutomations: [],
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
			schemaProviderLinks: [],
			relationshipAutomations: [],
		},
	};
};

const makeLayer = (input?: {
	readonly cached?: boolean;
	readonly events?: Array<string>;
	readonly deactivated?: Array<string>;
	readonly hasEntityReferences?: boolean;
	readonly installed?: Array<StoredPlugin>;
	readonly publish?: RedisService["publish"];
	readonly hasIntegrationReferences?: boolean;
	readonly afterPersist?: Effect.Effect<void>;
	readonly persisted?: Array<NormalizedPlugin>;
	readonly hasWorkflowReferences?: () => boolean;
	readonly repositoryList?: PluginRepository["list"];
	readonly deactivate?: PluginRepository["deactivate"];
	readonly initialInstalled?: ReadonlyArray<StoredPlugin>;
	readonly lockIngestion?: PluginRepository["lockIngestion"];
	readonly collectGarbage?: ScriptGarbageCollector["collect"];
	readonly published?: Array<{ channel: string; message: string }>;
	readonly transactionRunnerLayer?: Layer.Layer<TransactionRunner>;
}) => {
	const installed = input?.installed ?? [...(input?.initialInstalled ?? [])];
	const registry = makeDefinitionRegistry();
	const registryLayer = Layer.succeed(
		DefinitionRegistry,
		Object.assign(registry, { _tag: "DefinitionRegistry" as const }),
	);
	const loaderLayer = PluginLoader.Default.pipe(Layer.provide(registryLayer));
	const repositoryLayer = makeRepository({
		list: input?.repositoryList ?? (() => Effect.succeed(installed)),
		deactivate:
			input?.deactivate ??
			((slug) =>
				Effect.sync(() => {
					input?.events?.push("deactivate");
					input?.deactivated?.push(slug);
					const index = installed.findIndex((plugin) => plugin.manifest.metadata.slug === slug);
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
		hasIntegrationReferences: () => Effect.succeed(input?.hasIntegrationReferences ?? false),
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
	const workflowReferenceLayer = Layer.mock(SandboxWorkflowReferenceRepository)({
		_tag: "SandboxWorkflowReferenceRepository",
		hasReferences: () =>
			Effect.sync(() => {
				input?.events?.push("workflow-reference");
				return input?.hasWorkflowReferences?.() ?? false;
			}),
	});
	const transactionsLayer = input?.transactionRunnerLayer ?? transactionLayer;
	const garbageCollectorLayer = Layer.mock(ScriptGarbageCollector)({
		_tag: "ScriptGarbageCollector",
		collect: input?.collectGarbage ?? (() => Effect.sync(() => undefined)),
		recordKernelContentHashes: () => Effect.void,
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
	const ingestionLayer = PluginIngestionService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				loaderLayer,
				redisLayer,
				repositoryLayer,
				dbRunnerLayer,
				transactionsLayer,
				garbageCollectorLayer,
				workflowReferenceLayer,
			),
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

it.effect("returns a committed install when Redis publication fails", () => {
	const persisted: Array<NormalizedPlugin> = [];
	return Effect.gen(function* () {
		const loader = yield* PluginLoader;
		const ingestion = yield* PluginIngestionService;
		const source = yield* loadPluginSource(fixturePackageRoot(), fixtureManifest());
		const plugin = yield* ingestion.ingestPlugin(source);

		expect(persisted).toEqual([plugin]);
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

it.effect("rejects user bootstrap declarations through ordinary runtime ingestion", () => {
	const persisted: Array<NormalizedPlugin> = [];
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const manifest = userBootstrapManifest();
		const source = yield* loadPluginSource(fixturePackageRoot(), {
			...manifest,
			metadata: { ...manifest.metadata, slug: "media" },
		});
		const exit = yield* Effect.exit(ingestion.installPlugin(source));

		expect(Exit.isFailure(exit)).toBe(true);
		expect(String(exit)).toContain(
			"User bootstrap declarations are allowed only for boot-configured trusted plugins",
		);
		expect(persisted).toEqual([]);
	}).pipe(Effect.provide(makeLayer({ persisted })));
});

it.effect("accepts user bootstrap declarations through trusted boot ingestion", () => {
	const persisted: Array<NormalizedPlugin> = [];
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const manifest = userBootstrapManifest();
		const source = yield* loadPluginSource(fixturePackageRoot(), {
			...manifest,
			metadata: { ...manifest.metadata, slug: "media" },
		});
		const plugin = yield* ingestion.ingestTrustedPlugin(source);

		expect(plugin.manifest.userBootstrap).toEqual([
			{
				slug: "fixture",
				scriptSlug: "fixture.user-bootstrap",
				description: "Bootstrap fixture user data",
			},
		]);
		expect(persisted).toEqual([plugin]);
	}).pipe(Effect.provide(makeLayer({ persisted })));
});

it.effect("rejects user bootstrap declarations for non-configured trusted plugin slugs", () => {
	const persisted: Array<NormalizedPlugin> = [];
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const source = yield* loadPluginSource(fixturePackageRoot(), userBootstrapManifest());
		const exit = yield* Effect.exit(ingestion.ingestTrustedPlugin(source));

		expect(Exit.isFailure(exit)).toBe(true);
		expect(String(exit)).toContain(
			"User bootstrap declarations are allowed only for boot-configured trusted plugins",
		);
		expect(persisted).toEqual([]);
	}).pipe(Effect.provide(makeLayer({ persisted })));
});

it.effect("validates automation bindings against definitions from installed plugins", () => {
	const installedMedia = makeStoredPlugin(definitionOwnerManifest(), "media-source-hash");
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		yield* ingestion.rebuild();
		const source = yield* loadPluginSource(fixturePackageRoot(), {
			...fixtureManifest(),
			bindings: {
				...fixtureManifest().bindings,
				entityAutomations: [
					{ operation: "create", entitySchemaSlug: "movie", scriptSlug: "fixture.automation" },
				],
			},
		});

		const plugin = yield* ingestion.ingestPlugin(source);
		expect(plugin.manifest.bindings.entityAutomations).toEqual([
			{ operation: "create", entitySchemaSlug: "movie", scriptSlug: "fixture.automation" },
		]);
	}).pipe(Effect.provide(makeLayer({ initialInstalled: [installedMedia] })));
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

		const plugin = yield* ingestion.ingestPlugin(source);
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

		const exit = yield* Effect.exit(ingestion.ingestPlugin(source));
		expect(String(exit)).toContain(
			"cannot reference kernel source-zero formatter: automation.notification",
		);
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

			const exit = yield* Effect.exit(ingestion.ingestPlugin(source));
			expect(Exit.isFailure(exit)).toBe(true);
			expect(String(exit)).toContain("BadRequest");
			expect(String(exit)).toContain(
				kind === "missing" ? "references missing script" : "automation script",
			);
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

		const exit = yield* Effect.exit(ingestion.ingestPlugin(source));
		expect(String(exit)).toContain("Duplicate script slug: automation.notification");
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

		expect(Exit.isFailure(exit)).toBe(true);
		expect(String(exit)).toContain("references missing script");
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

it.effect("returns a committed uninstall when Redis publication fails", () => {
	const stored = makeStoredPlugin(fixtureManifest(), "stored-source-hash");
	const deactivated: Array<string> = [];
	return Effect.gen(function* () {
		const loader = yield* PluginLoader;
		const ingestion = yield* PluginIngestionService;
		yield* ingestion.rebuild();

		const removed = yield* ingestion.uninstallPlugin("fixture");
		expect(removed.slug).toBe("fixture");
		expect(deactivated).toEqual(["fixture"]);
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

it.scoped("periodically rebuilds a peer after lost install and uninstall publications", () =>
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
		yield* runPluginRegistryReconciliation(Queue.take(ticks), peer).pipe(Effect.forkScoped);

		const source = yield* loadPluginSource(fixturePackageRoot(), fixtureManifest());
		yield* writer.ingestPlugin(source);
		expect(peerLoader.getSnapshot().plugins["fixture"]).toBeUndefined();

		yield* Queue.offer(ticks, undefined);
		yield* Queue.take(rebuilds);
		expect(peerLoader.getSnapshot().plugins["fixture"]).toBeDefined();

		yield* writer.uninstallPlugin("fixture");
		expect(peerLoader.getSnapshot().plugins["fixture"]).toBeDefined();

		yield* Queue.offer(ticks, undefined);
		yield* Queue.take(rebuilds);
		expect(peerLoader.getSnapshot().plugins["fixture"]).toBeUndefined();
	}),
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
			new Conflict({
				message:
					"Plugin 'fixture' cannot be uninstalled while running or suspended workflows reference it",
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
		expect(deactivated).toEqual(["fixture"]);
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
			const transactionRunnerLayer = Layer.succeed(
				TransactionRunner,
				<A, E, R>(effect: Effect.Effect<A, E, R>) =>
					Effect.provideService(
						effect.pipe(
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
						),
						CurrentDb,
						Object.create(null),
					),
			);
			const layer = makeLayer({
				events,
				initialInstalled: [stored],
				transactionRunnerLayer,
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
				const uninstall = yield* Effect.fork(Effect.exit(ingestion.uninstallPlugin("fixture")));
				yield* Deferred.await(exclusiveAcquired);
				expect(events).toEqual(["exclusive-acquired"]);

				const dispatch = yield* Effect.fork(Effect.exit(registerWorkflowReference));
				yield* Deferred.await(sharedAttempted);
				expect(events).toEqual(["exclusive-acquired", "shared-attempt"]);

				yield* Deferred.succeed(allowInspection, undefined);
				const uninstallExit = yield* Fiber.join(uninstall);
				const dispatchExit = yield* Fiber.join(dispatch);

				if (hasExistingReference) {
					assertExitFails(
						uninstallExit,
						new Conflict({
							message:
								"Plugin 'fixture' cannot be uninstalled while running or suspended workflows reference it",
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

		expect(String(exit)).toContain("Conflict");
		expect(String(exit)).toContain("entities reference its schemas");
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
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const exit = yield* Effect.exit(ingestion.uninstallPlugin("fixture"));

		assertExitFails(
			exit,
			new Conflict({
				message: "Plugin 'fixture' cannot be uninstalled while integrations reference it",
			}),
		);
		expect(deactivated).toEqual([]);
	}).pipe(
		Effect.provide(
			makeLayer({ deactivated, hasIntegrationReferences: true, initialInstalled: [stored] }),
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

		expect(String(exit)).toContain("Conflict");
		expect(String(exit)).toContain("references missing script");
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
	const manifest = definitionOwnerManifest();
	const stored = makeStoredPlugin(manifest, "media-source-hash");
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const exit = yield* Effect.exit(ingestion.uninstallPlugin(manifest.metadata.slug));

		expect(String(exit)).toContain("Conflict");
		expect(String(exit)).toContain("Boot-configured plugin");
	}).pipe(Effect.provide(makeLayer({ initialInstalled: [stored] })));
});

it.effect("short-circuits compilation and persistence for a matching source hash", () => {
	const persisted: Array<NormalizedPlugin> = [];
	const published: Array<{ channel: string; message: string }> = [];
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const loader = yield* PluginLoader;
		const source = yield* loadPluginSource(fixturePackageRoot("diagnostic"), fixtureManifest());
		const plugin = yield* ingestion.ingestPlugin(source);

		expect(plugin.scripts[0]?.compiledCode).toBe("cached compiled");
		expect(persisted).toHaveLength(0);
		expect(loader.getSnapshot().plugins["fixture"]).toBeDefined();
		expect(published).toEqual([
			expect.objectContaining({ channel: redisKeys.pluginRegistryChannel }),
		]);
	}).pipe(Effect.provide(makeLayer({ cached: true, persisted, published })));
});

it.effect("rejects manifest, slash, collision, dangling binding, and compiler failures", () => {
	const cases: ReadonlyArray<{ manifest: unknown; packageRoot: string }> = [
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
