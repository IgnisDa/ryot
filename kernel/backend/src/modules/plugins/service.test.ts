import { BunFileSystem } from "@effect/platform-bun";
import { assert, expect, it } from "@effect/vitest";
import type { ClientPluginCompilerInput } from "@ryot-app/client-plugin-compiler";
import {
	clientPluginCompilationFailure,
	clientPluginCompilerDiagnostic,
} from "@ryot-app/client-plugin-compiler/diagnostics";
import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	type PluginClientArtifact,
} from "@ryot-app/client-plugin-contract";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { PluginConflictError } from "@ryot-app/contract/modules/plugins/schemas";
import { PluginSlug } from "@ryot-app/contract/schema/brands";
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Option } from "effect";

import { Database } from "#lib/infrastructure/db/service";
import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import { assertExitFails } from "#lib/test-utils/assertions";
import { databaseLayer, makeRedisService, type MockOverrides } from "#lib/test-utils/effect";
import { kernelDefinitionSource } from "#modules/definition-registry/kernel-source";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { ClientPluginCompiler } from "#modules/plugins/client-plugin-compiler";
import {
	SandboxWorkflowReferenceRegistrationError,
	SandboxWorkflowReferenceRepository,
} from "#modules/sandbox/workflow-reference-repository";

import { PluginCatalogInvalidatorLive } from "./catalog-events";
import { toPluginScriptDescriptor } from "./pipeline";
import { PluginRepository } from "./repository";
import { PluginRevisionActivation } from "./revision-activation";
import { PluginIngestionService } from "./service";
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
	mockRepository({
		resolveEnvironmentConfig: ({ id }) => Effect.succeed(`${id}-config`),
		validateConfigurationKeys: () => Effect.void.pipe(Effect.as(undefined)),
		...overrides,
	});

const makeStoredPlugin = (manifest: PluginManifest, sourceHash: string): StoredPlugin => {
	return {
		manifest,
		sourceHash,
		ownerId: null,
		scope: "system",
		status: "active",
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
		hooks: [],
		scripts: [],
		signalSchemas: [],
		relationshipSchemas: [],
		metadata: { ...fixture.metadata, slug: "example", name: "Example" },
		entitySchemas: [{ ...entitySchema, slug: "item", eventSchemas: [] }],
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
		hooks: [
			{
				stage: "after",
				name: "Created",
				delivery: "async",
				slug: "dependent.created",
				scriptSlug: "fixture.automation",
				targets: [{ entitySchemaSlug, resource: "entity", operation: "create" }],
			},
		],
	};
};

const formatterOwnerManifest = (): PluginManifest => {
	const fixture = fixtureManifest();
	const script = fixture.scripts[0];
	assert(script);
	return {
		...fixture,
		hooks: [],
		savedViews: [],
		entitySchemas: [],
		signalSchemas: [],
		relationshipSchemas: [],
		scripts: [{ ...script, slug: "formatter-owner.notification" }],
		metadata: { ...fixture.metadata, name: "Formatter owner", slug: "formatter-owner" },
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
		hooks: [],
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
	readonly repositoryList?: PluginRepository["Service"]["listActiveSystemPlugins"];
	readonly deactivate?: PluginRepository["Service"]["deactivate"];
	readonly published?: Array<{ channel: string; message: string }>;
	readonly clientCompile?: ClientPluginCompiler["Service"]["compile"];
	readonly lockIngestion?: PluginRepository["Service"]["lockIngestion"];
	readonly activated?: Array<string>;
}) => {
	const installed = input?.installed ?? [...(input?.initialInstalled ?? [])];
	const repositoryLayer = makeRepository({
		hasEntityReferences: () => Effect.succeed(input?.hasEntityReferences ?? false),
		hasDefinitionReferences: () => Effect.succeed(input?.hasDefinitionReferences ?? false),
		listActiveSystemPlugins: input?.repositoryList ?? (() => Effect.sync(() => [...installed])),
		findActiveSystemPlugin: (slug) =>
			Effect.sync(() => installed.find((plugin) => plugin.slug === slug) ?? null),
		lockIngestion:
			input?.lockIngestion ??
			(() =>
				Effect.sync(() => {
					input?.events?.push("lock");
				})),
		hasIntegrationReferences: (fence) =>
			Effect.sync(() => {
				input?.integrationFences?.push(fence);
				return input?.hasIntegrationReferences ?? false;
			}),
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
		findBySourceHash: ({ sourceHash }) =>
			Effect.sync(() => {
				if (!input?.cached) {
					return null;
				}
				const manifest: PluginManifest = input.cachedManifest ?? fixtureManifest();
				const cached = makeStoredPlugin(manifest, sourceHash);
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
					const { scripts, files: _files, ...revision } = plugin;
					const stored = {
						...revision,
						...identity,
						id: pluginId,
						status: "active",
						scripts: scripts.map(toPluginScriptDescriptor),
					};
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
				return yield* Effect.succeed(pluginId);
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
	const definitionsLayer = Layer.mock(DefinitionRepository)({
		readKernelSource: Effect.succeed(kernelDefinitionSource()),
	});
	const ingestionLayer = PluginIngestionService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				repositoryLayer,
				definitionsLayer,
				testDatabaseLayer,
				systemPluginsLayer,
				workflowReferenceLayer,
				clientCompilerLayer,
				Layer.succeed(PluginRevisionActivation, {
					activated: (pluginId) => Effect.sync(() => void input?.activated?.push(pluginId)),
				}),
				PluginCatalogInvalidatorLive.pipe(Layer.provide(redisLayer)),
			),
		),
	);
	return Layer.mergeAll(BunFileSystem.layer, ingestionLayer, testDatabaseLayer);
};

it.effect("validates, compiles, content-addresses, persists, and publishes", () => {
	const persisted: Array<NormalizedPlugin> = [];
	const activated: Array<string> = [];
	const published: Array<{ channel: string; message: string }> = [];
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const source = yield* loadPluginSource(fixturePackageRoot(), fixtureManifest());
		const plugin = yield* ingestion.ingestSystemPlugin(source);

		expect(plugin.sourceHash).toMatch(/^[a-f0-9]{64}$/);
		expect(plugin.scripts[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/);
		const [persistedPackage] = persisted;
		assert(persisted.length === 1 && persistedPackage);
		expect(persistedPackage.files).toEqual(source.files);
		expect(persistedPackage.manifest).toEqual(plugin.manifest);
		expect(persistedPackage.sourceHash).toBe(plugin.sourceHash);
		expect(persistedPackage.scripts.map(toPluginScriptDescriptor)).toEqual(plugin.scripts);
		expect(plugin.manifest.hooks).toEqual(fixtureManifest().hooks);
		expect(published).toHaveLength(1);
		expect(published[0]?.channel).toBe(redisKeys.pluginCatalogChannel);
		expect(activated).toEqual([plugin.id]);
	}).pipe(Effect.provide(makeLayer({ persisted, published, activated })));
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
					entry: "backend/providers/fixture/provider/details.sandbox.ts",
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
					entry: "backend/providers/fixture/provider/search.sandbox.ts",
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
		const ingestion = yield* PluginIngestionService;
		const source = yield* loadPluginSource(fixturePackageRoot(), fixtureManifest());
		const plugin = yield* ingestion.ingestSystemPlugin(source);

		const [persistedPackage] = persisted;
		assert(persisted.length === 1 && persistedPackage);
		expect(persistedPackage.files).toEqual(source.files);
		expect(persistedPackage.manifest).toEqual(plugin.manifest);
		expect(persistedPackage.sourceHash).toBe(plugin.sourceHash);
		expect(persistedPackage.scripts.map(toPluginScriptDescriptor)).toEqual(plugin.scripts);
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
				entry: "backend/bootstrap/user-bootstrap.sandbox.ts",
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
		const [persistedPackage] = persisted;
		assert(persisted.length === 1 && persistedPackage);
		expect(persistedPackage.files).toEqual(source.files);
		expect(persistedPackage.manifest).toEqual(plugin.manifest);
		expect(persistedPackage.sourceHash).toBe(plugin.sourceHash);
		expect(persistedPackage.scripts.map(toPluginScriptDescriptor)).toEqual(plugin.scripts);
	}).pipe(Effect.provide(makeLayer({ persisted })));
});

it.effect("rejects hooks targeting schemas outside the authored manifest surface", () => {
	const installedExample = makeStoredPlugin(definitionOwnerManifest(), "example-source-hash");
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const source = yield* loadPluginSource(fixturePackageRoot(), {
			...fixtureManifest(),
			hooks: [
				...fixtureManifest().hooks,
				{
					stage: "after",
					delivery: "async",
					name: "Item created",
					slug: "fixture.item-created",
					scriptSlug: "fixture.automation",
					targets: [{ resource: "entity", operation: "create", entitySchemaSlug: "item" }],
				},
			],
		});

		expect(failureOf(yield* Effect.exit(ingestion.ingestSystemPlugin(source)))).toMatchObject({
			_tag: "PluginRequestError",
			reason: { code: "validation-failed" },
		});
	}).pipe(Effect.provide(makeLayer({ initialInstalled: [installedExample] })));
});

it.effect("rejects a notification hook owned by another plugin", () => {
	const owner = makeStoredPlugin(formatterOwnerManifest(), "formatter-owner-source-hash");
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const manifest = fixtureManifest();
		const signalSchema = manifest.signalSchemas[0];
		assert(signalSchema);
		const source = yield* loadPluginSource(fixturePackageRoot(), {
			...manifest,
			signalSchemas: [{ ...signalSchema, notificationHookSlug: "formatter-owner.notification" }],
		});

		expect(failureOf(yield* Effect.exit(ingestion.ingestSystemPlugin(source)))).toMatchObject({
			_tag: "PluginRequestError",
			reason: { code: "validation-failed" },
		});
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
			signalSchemas: [{ ...signalSchema, notificationHookSlug: "automation.notification" }],
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
			const {
				automationType: _automationType,
				inputProjection: _inputProjection,
				...common
			} = script;
			const notificationHookSlug =
				kind === "missing" ? "missing.notification" : signalSchema.notificationHookSlug;
			const source = yield* loadPluginSource(fixturePackageRoot(), {
				...manifest,
				signalSchemas: [{ ...signalSchema, notificationHookSlug }],
				scripts:
					kind === "wrong-kind" ? [{ ...common, kind: "operation" as const }] : manifest.scripts,
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

it.effect("refuses an active system set with a dangling notification formatter", () => {
	const manifest = fixtureManifest();
	const signalSchema = manifest.signalSchemas[0];
	assert(signalSchema);
	const stored = makeStoredPlugin(
		{
			...manifest,
			signalSchemas: [{ ...signalSchema, notificationHookSlug: "missing.notification" }],
		},
		"stored-source-hash",
	);
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const exit = yield* Effect.exit(ingestion.validateActiveSystemPlugins());

		assert(Exit.isFailure(exit));
		const failure = Cause.findErrorOption(exit.cause);
		assert(Option.isSome(failure));
		assert(failure.value._tag === "PluginValidationError");
		expect(failure.value.issues).toContain(
			"Notification hook references missing definition: missing.notification",
		);
	}).pipe(Effect.provide(makeLayer({ initialInstalled: [stored] })));
});

it.effect("lists active plugins and uninstalls without deleting historical scripts", () => {
	const stored = makeStoredPlugin(fixtureManifest(), "stored-source-hash");
	const deactivated: Array<string> = [];
	const published: Array<{ channel: string; message: string }> = [];
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;

		expect(yield* ingestion.listPlugins()).toEqual([expect.objectContaining({ slug: "fixture" })]);

		const removed = yield* ingestion.uninstallPlugin("fixture");
		expect(removed).toEqual({ pluginId: stored.id });
		expect(deactivated).toEqual(["fixture-plugin-id"]);
		expect(yield* ingestion.listPlugins()).toEqual([]);
		expect(published).toEqual([
			expect.objectContaining({ channel: redisKeys.pluginCatalogChannel }),
		]);
	}).pipe(Effect.provide(makeLayer({ published, deactivated, initialInstalled: [stored] })));
});

it.effect("returns a committed uninstall when Redis publication fails", () => {
	const stored = makeStoredPlugin(fixtureManifest(), "stored-source-hash");
	const deactivated: Array<string> = [];
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;

		const removed = yield* ingestion.uninstallPlugin("fixture");
		expect(removed).toEqual({ pluginId: stored.id });
		expect(deactivated).toEqual(["fixture-plugin-id"]);
		expect(yield* ingestion.listPlugins()).toEqual([]);
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

it.effect("deactivates a plugin with queued work while retaining its immutable package", () => {
	const stored = makeStoredPlugin(fixtureManifest(), "stored-source-hash");
	const deactivated: Array<string> = [];
	const published: Array<{ channel: string; message: string }> = [];
	const referenceState = { active: true };
	const events: Array<string> = [];
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const removed = yield* ingestion.uninstallPlugin("fixture");

		expect(removed).toEqual({ pluginId: stored.id });
		expect(events).toEqual(["lock", "deactivate", "publish"]);
		expect(deactivated).toEqual(["fixture-plugin-id"]);
		expect(published).toEqual([
			{ message: "plugin-catalog-invalidated", channel: redisKeys.pluginCatalogChannel },
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
				hasEntityReferences: hasExistingReference,
				deactivate: () =>
					Effect.sync(() => {
						active = false;
						events.push("deactivated");
					}),
				lockIngestion: () =>
					Effect.gen(function* () {
						exclusive = true;
						events.push("exclusive-acquired");
						yield* Deferred.succeed(exclusiveAcquired, undefined);
						yield* Deferred.await(allowInspection);
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
							reason: { code: "entity-referenced", pluginSlug: PluginSlug.make("fixture") },
						}),
					);
					expect(dispatchExit).toEqual(Exit.succeed({ status: "registered" }));
					expect(events).toEqual([
						"exclusive-acquired",
						"shared-attempt",
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
			reason: { pluginSlug: "fixture", code: "entity-referenced" },
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
			reason: { pluginSlug: "fixture", code: "definition-referenced" },
		});
		expect(deactivated).toEqual([]);
	}).pipe(Effect.provide(makeLayer({ deactivated, initialInstalled: [owner, dependent] })));
});

it.effect(
	"uninstalls an unrelated formatter without affecting plugin-local notification hooks",
	() => {
		const owner = makeStoredPlugin(formatterOwnerManifest(), "formatter-owner-source-hash");
		const manifest = fixtureManifest();
		const signalSchema = manifest.signalSchemas[0];
		assert(signalSchema);
		const dependent = makeStoredPlugin(
			{ ...manifest, signalSchemas: [signalSchema] },
			"dependent-source-hash",
		);
		const deactivated: Array<string> = [];
		return Effect.gen(function* () {
			const ingestion = yield* PluginIngestionService;
			expect(yield* ingestion.uninstallPlugin("formatter-owner")).toEqual({ pluginId: owner.id });
			expect(deactivated).toEqual([owner.id]);
			expect((yield* ingestion.listPlugins()).map(({ slug }) => slug)).toEqual([
				manifest.metadata.slug,
			]);
		}).pipe(Effect.provide(makeLayer({ deactivated, initialInstalled: [owner, dependent] })));
	},
);

it.effect("refuses uninstall while another plugin relationship targets its entity schema", () => {
	const owner = makeStoredPlugin(fixtureManifest(), "owner-source-hash");
	const dependent = makeStoredPlugin(
		relationshipDependentManifest("fixture-entity"),
		"dependent-source-hash",
	);
	const deactivated: Array<string> = [];
	const published: Array<{ channel: string; message: string }> = [];
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const plugins = yield* ingestion.listPlugins();

		const exit = yield* Effect.exit(ingestion.uninstallPlugin("fixture"));

		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			const error = Option.getOrThrow(Cause.findErrorOption(exit.cause));
			expect(error).toMatchObject({
				_tag: "PluginConflictError",
				reason: { pluginSlug: "fixture", code: "definition-referenced" },
			});
		}
		expect(yield* ingestion.listPlugins()).toEqual(plugins);
		expect(deactivated).toEqual([]);
		expect(published).toEqual([]);
	}).pipe(
		Effect.provide(makeLayer({ published, deactivated, initialInstalled: [owner, dependent] })),
	);
});

it.effect("refuses uninstall for a system plugin", () => {
	const manifest = definitionOwnerManifest();
	const stored = makeStoredPlugin(manifest, "example-source-hash");
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const exit = yield* Effect.exit(ingestion.uninstallPlugin(manifest.metadata.slug));

		expect(failureOf(exit)).toMatchObject({
			_tag: "PluginConflictError",
			reason: { pluginSlug: "example", code: "system-plugin" },
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

it.effect("keeps a no-client plugin on the source-hash cache path", () => {
	const events: Array<string> = [];
	const persisted: Array<NormalizedPlugin> = [];
	const published: Array<{ channel: string; message: string }> = [];
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const source = yield* loadPluginSource(fixturePackageRoot("diagnostic"), fixtureManifest());
		const plugin = yield* ingestion.ingestSystemPlugin(source);

		expect(plugin.scripts[0]?.contentHash).toBe("cached-hash-fixture.automation");
		expect(persisted).toHaveLength(0);
		expect(events).toEqual(["lock", "publish"]);
		expect(published).toEqual([
			expect.objectContaining({ channel: redisKeys.pluginCatalogChannel }),
		]);
	}).pipe(Effect.provide(makeLayer({ events, persisted, published, cached: true })));
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
		const ingestion = yield* PluginIngestionService;
		const source = yield* loadPluginSource(fixturePackageRoot("diagnostic"), cachedManifest);
		const exit = yield* Effect.exit(ingestion.ingestSystemPlugin(source));

		expect(failureOf(exit)).toMatchObject({
			_tag: "PluginRequestError",
			reason: { code: "validation-failed" },
		});
		expect(events).toEqual([]);
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
		{ manifest: {}, reasonCode: "validation-failed", packageRoot: fixturePackageRoot() },
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
				hooks: [
					...fixtureManifest().hooks,
					{
						stage: "after",
						name: "Missing",
						delivery: "async",
						scriptSlug: "missing",
						slug: "fixture.missing",
						targets: [
							{ resource: "entity", operation: "create", entitySchemaSlug: "fixture-entity" },
						],
					},
				],
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
								line: 19,
								code: "TS2322",
								phase: "compile",
								severity: "error",
								file: "backend/automations/fixture.sandbox.ts",
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
	client: {
		homeView: null,
		apiVersion: CLIENT_API_VERSION,
		exports: {
			summary: { kind: "component", entry: "client/index.ts", automaticEntityPresentations: false },
		},
	},
});

const clientArtifact = (): PluginClientArtifact => ({
	hash: "client-artifact-hash",
	format: CLIENT_ARTIFACT_FORMAT,
	apiVersion: CLIENT_API_VERSION,
	compilerVersion: CLIENT_COMPILER_VERSION,
	bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
	files: [
		{
			name: "plugin.js",
			contentType: "text/javascript; charset=utf-8",
			contents: new TextEncoder().encode("export {};"),
		},
		{
			name: "index.html",
			contentType: "text/html; charset=utf-8",
			contents: new TextEncoder().encode("<!doctype html>"),
		},
	],
});

it.effect("skips client validation for a matching source hash", () => {
	const requests: Array<ClientPluginCompilerInput> = [];
	const persisted: Array<NormalizedPlugin> = [];
	return Effect.gen(function* () {
		const ingestion = yield* PluginIngestionService;
		const source = yield* loadPluginSource(fixturePackageRoot(), clientManifest());
		yield* ingestion.ingestSystemPlugin(source);

		expect(requests).toEqual([]);
		expect(persisted).toEqual([]);
	}).pipe(
		Effect.provide(
			makeLayer({
				persisted,
				cached: true,
				cachedManifest: clientManifest(),
				clientCompile: (request) =>
					Effect.sync(() => {
						requests.push(request);
						return clientArtifact();
					}),
			}),
		),
	);
});

it.effect(
	"validates the declared client sources without attaching an artifact to the plugin",
	() => {
		const artifact = clientArtifact();
		const persisted: Array<NormalizedPlugin> = [];
		const requests: Array<ClientPluginCompilerInput> = [];
		return Effect.gen(function* () {
			const ingestion = yield* PluginIngestionService;
			const source = yield* loadPluginSource(fixturePackageRoot(), clientManifest());
			yield* ingestion.ingestSystemPlugin(source);

			expect(requests).toEqual([
				{
					apiVersion: 1,
					files: source.files,
					pluginDependencies: [],
					name: clientManifest().metadata.name,
					publicExports: { summary: { kind: "component", entry: "client/index.ts" } },
				},
			]);
			expect(persisted).toEqual([
				expect.not.objectContaining({ clientArtifact: expect.anything() }),
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
	},
);

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
		{ scriptEntry: entry, path: "scripts\\script.ts" },
		{ scriptEntry: entry, path: "scripts//script.ts" },
		{ scriptEntry: entry, path: "scripts/./script.ts" },
		{ scriptEntry: entry, path: "scripts/../script.ts" },
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
					manifest: { ...manifest, scripts: [{ ...script, entry: scriptEntry }] },
					files:
						path === entry ? {} : { ...source.files, [path]: new TextEncoder().encode("source") },
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
