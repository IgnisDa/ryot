import { assert, expect, layer } from "@effect/vitest";
import { encodePluginCatalogInvalidatedMessage } from "@ryot-app/contract/modules/plugins/contract";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { PluginConflictError } from "@ryot-app/contract/modules/plugins/schemas";
import { PluginId, type PluginPackageId, type UserId } from "@ryot-app/contract/schema/brands";
import { emptySandboxExecutionMetadata } from "@ryot-app/contract/testing";
import { pluginBackendCompilerPlatformLayer } from "@ryot-app/plugin-backend-compiler/platform";
import { CLIENT_API_VERSION } from "@ryot-app/plugin-client-contract";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Option, Ref } from "effect";

import { kernelDefinitionSource } from "#modules/definitions/kernel-source";
import { DefinitionRepository } from "#modules/definitions/repository";
import {
	SandboxWorkflowReferenceRegistrationError,
	SandboxWorkflowReferenceRepository,
} from "#modules/scripts/registry/workflow-references";
import { DatabaseSession } from "#platform/db/session";
import { redisKeys, RedisService } from "#platform/redis";
import { databaseLayer, makeRedisService, type MockOverrides } from "#testing/effect";

import { PluginCatalogInvalidator } from "../catalog/events";
import { PluginInstallationRepository } from "../installations/repository";
import { loadPluginSource } from "../source.test-support";
import { fixtureManifest, fixturePackageRoot, testPluginPackageId } from "../test-support";
import { PluginIngestionRetirement } from "./ingestion-retirement";
import { PluginIngestionService } from "./ingestion-service";
import { toPluginScriptDescriptor } from "./pipeline";
import { PluginRepository } from "./repository";
import { PluginRevisionActivation } from "./revision-activation";
import { SystemPlugins } from "./system";
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

const makeStoredPlugin = (manifest: PluginManifest, contentHash: string): StoredPlugin => {
	return {
		manifest,
		contentHash,
		ownerId: null,
		scope: "system",
		status: "active",
		packageId: manifest.metadata.packageId,
		id: `${manifest.metadata.packageId}-plugin-id`,
		activationId: `${manifest.metadata.packageId}-activation`,
		scripts: manifest.scripts.map((script) => {
			const { entry, ...metadata } = script;
			return {
				entry,
				metadata,
				slug: script.slug,
				name: script.name,
				compiledFormat: 1,
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
		metadata: { ...fixture.metadata, name: "Example" },
		entitySchemas: [{ ...entitySchema, slug: "item", eventSchemas: [] }],
	};
};

const dependentManifest = (entitySchemaSlug: string): PluginManifest => {
	const fixture = fixtureManifest(testPluginPackageId());
	return {
		...fixture,
		signalSchemas: [],
		relationshipSchemas: [],
		metadata: { ...fixture.metadata, name: "Dependent" },
		entitySchemas: Array.from(fixture.entitySchemas, (entity) => ({
			...entity,
			slug: entitySchemaSlug,
		})),
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
	const fixture = fixtureManifest(testPluginPackageId());
	const script = fixture.scripts[0];
	assert(script);
	return {
		...fixture,
		hooks: [],
		savedViews: [],
		entitySchemas: [],
		signalSchemas: [],
		relationshipSchemas: [],
		metadata: { ...fixture.metadata, name: "Formatter owner" },
		scripts: [{ ...script, slug: "formatter-owner.notification" }],
	};
};

const relationshipDependentManifest = (targetEntitySchemaSlug: string): PluginManifest => {
	const fixture = fixtureManifest(testPluginPackageId());
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
		metadata: { ...fixture.metadata, name: "Dependent" },
		scripts: [{ ...script, slug: "dependent.automation" }],
		entitySchemas: [
			{ ...entitySchema, slug: "dependent-entity" },
			{ ...entitySchema, slug: targetEntitySchemaSlug },
		],
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

type PublishedMessage = { readonly channel: string; readonly message: string };

type ContentionRound = {
	readonly acquired: Deferred.Deferred<void>;
	readonly inspection: Deferred.Deferred<void>;
	readonly released: Deferred.Deferred<void>;
	readonly sharedAttempted: Deferred.Deferred<void>;
};

class FakeIngestionDependencies extends Context.Service<
	FakeIngestionDependencies,
	{
		readonly events: Effect.Effect<ReadonlyArray<string>>;
		readonly activated: Effect.Effect<ReadonlyArray<string>>;
		readonly deactivated: Effect.Effect<ReadonlyArray<string>>;
		readonly persisted: Effect.Effect<ReadonlyArray<NormalizedPlugin>>;
		readonly published: Effect.Effect<ReadonlyArray<PublishedMessage>>;
		readonly integrationFences: Effect.Effect<ReadonlyArray<unknown>>;
		readonly setEntityReferences: (hasReferences: boolean) => Effect.Effect<void>;
		readonly replaceInstalled: (plugin: StoredPlugin) => Effect.Effect<void>;
		readonly contention: {
			readonly beginRound: Effect.Effect<void>;
			readonly exclusiveAcquired: Effect.Effect<void>;
			readonly sharedAttempted: Effect.Effect<void>;
			readonly allowInspection: Effect.Effect<void>;
			readonly releaseExclusive: Effect.Effect<void>;
			readonly registerWorkflowReference: Effect.Effect<
				{ readonly status: "registered" },
				SandboxWorkflowReferenceRegistrationError
			>;
		};
	}
>()("test/FakeIngestionDependencies") {}

class IngestionFakeState extends Context.Service<
	IngestionFakeState,
	{
		readonly active: Ref.Ref<boolean>;
		readonly exclusive: Ref.Ref<boolean>;
		readonly events: Ref.Ref<ReadonlyArray<string>>;
		readonly activated: Ref.Ref<ReadonlyArray<string>>;
		readonly deactivated: Ref.Ref<ReadonlyArray<string>>;
		readonly installed: Ref.Ref<ReadonlyArray<StoredPlugin>>;
		readonly persisted: Ref.Ref<ReadonlyArray<NormalizedPlugin>>;
		readonly receipts: Ref.Ref<
			ReadonlyArray<{
				activationId: string;
				ownerId: string | null;
				packageId: PluginPackageId;
				pluginId: string;
				installationId: string | null;
			}>
		>;
		readonly published: Ref.Ref<ReadonlyArray<PublishedMessage>>;
		readonly integrationFences: Ref.Ref<ReadonlyArray<unknown>>;
		readonly hasEntityReferences: Ref.Ref<boolean>;
		readonly round: Ref.Ref<ContentionRound>;
	}
>()("test/IngestionFakeState") {}

const append = <A>(ref: Ref.Ref<ReadonlyArray<A>>, value: A) =>
	Ref.update(ref, (all) => [...all, value]);

const upsertBy = (
	plugins: ReadonlyArray<StoredPlugin>,
	plugin: StoredPlugin,
	matches: (candidate: StoredPlugin) => boolean,
) =>
	plugins.some(matches)
		? plugins.map((candidate) => (matches(candidate) ? plugin : candidate))
		: [...plugins, plugin];

const makeContentionRound = Effect.gen(function* () {
	return {
		acquired: yield* Deferred.make<void>(),
		released: yield* Deferred.make<void>(),
		inspection: yield* Deferred.make<void>(),
		sharedAttempted: yield* Deferred.make<void>(),
	};
});

const makeLayer = (input?: {
	readonly cached?: boolean;
	readonly publishFailure?: string;
	readonly contendedLock?: boolean;
	readonly hasEntityReferences?: boolean;
	readonly hasWorkflowReferences?: boolean;
	readonly cachedManifest?: PluginManifest;
	readonly hasDefinitionReferences?: boolean;
	readonly hasIntegrationReferences?: boolean;
	readonly systemPluginNames?: ReadonlySet<string>;
	readonly initialInstalled?: ReadonlyArray<StoredPlugin>;
	readonly quarantined?: Effect.Success<
		ReturnType<PluginInstallationRepository["Service"]["quarantinePackageIdentityConflicts"]>
	>;
}) => {
	const stateLayer = Layer.effect(
		IngestionFakeState,
		Effect.gen(function* () {
			return {
				active: yield* Ref.make(true),
				exclusive: yield* Ref.make(false),
				round: yield* Ref.make(yield* makeContentionRound),
				events: yield* Ref.make<ReadonlyArray<string>>([]),
				activated: yield* Ref.make<ReadonlyArray<string>>([]),
				deactivated: yield* Ref.make<ReadonlyArray<string>>([]),
				integrationFences: yield* Ref.make<ReadonlyArray<unknown>>([]),
				persisted: yield* Ref.make<ReadonlyArray<NormalizedPlugin>>([]),
				published: yield* Ref.make<ReadonlyArray<PublishedMessage>>([]),
				hasEntityReferences: yield* Ref.make(input?.hasEntityReferences ?? false),
				installed: yield* Ref.make<ReadonlyArray<StoredPlugin>>(input?.initialInstalled ?? []),
				receipts: yield* Ref.make<
					ReadonlyArray<{
						activationId: string;
						ownerId: string | null;
						packageId: PluginPackageId;
						pluginId: string;
						installationId: string | null;
					}>
				>([]),
			};
		}),
	);
	const fakesLayer = Layer.unwrap(
		Effect.gen(function* () {
			const state = yield* IngestionFakeState;
			const session = yield* DatabaseSession;
			const recordEvent = (event: string) => append(state.events, event);
			const currentRound = Ref.get(state.round);
			const contendedLock = Effect.gen(function* () {
				const round = yield* currentRound;
				yield* Ref.set(state.exclusive, true);
				yield* recordEvent("exclusive-acquired");
				yield* Deferred.succeed(round.acquired, undefined);
				yield* Deferred.await(round.inspection);
			});
			const repository = makeRepository({
				findReferencedRemovedDeclarations: () => Effect.succeed([]),
				hasEntityReferences: () => Ref.get(state.hasEntityReferences),
				resolveEnvironmentConfigs: () => recordEvent("resolve-all-environments"),
				lockIngestion: () => (input?.contendedLock ? contendedLock : recordEvent("lock")),
				hasDefinitionReferences: () => Effect.succeed(input?.hasDefinitionReferences ?? false),
				listActiveSystemPlugins: () => Effect.map(Ref.get(state.installed), (all) => [...all]),
				resolveEnvironmentConfig: ({ id }) =>
					recordEvent(`resolve-environment:${id}`).pipe(Effect.as(`${id}-config`)),
				hasIntegrationReferences: (fence) =>
					append(state.integrationFences, fence).pipe(
						Effect.as(input?.hasIntegrationReferences ?? false),
					),
				findActiveSystemPluginById: (id) =>
					Effect.map(
						Ref.get(state.installed),
						(all) => all.find((plugin) => plugin.id === id) ?? null,
					),
				findUninstallReceipt: (activationId) =>
					Effect.map(
						Ref.get(state.receipts),
						(all) => all.find((receipt) => receipt.activationId === activationId) ?? null,
					),
				findActiveSystemPluginByPackageId: (packageId) =>
					Effect.map(
						Ref.get(state.installed),
						(all) => all.find((plugin) => plugin.packageId === packageId) ?? null,
					),
				recordUninstallReceipt: (receipt) =>
					append(state.receipts, {
						pluginId: receipt.pluginId,
						packageId: receipt.packageId,
						ownerId: receipt.ownerId ?? null,
						activationId: receipt.activationId,
						installationId: receipt.installationId ?? null,
					}),
				deactivate: (pluginId) =>
					input?.contendedLock
						? Ref.set(state.active, false).pipe(Effect.andThen(recordEvent("deactivated")))
						: Effect.all([
								recordEvent("deactivate"),
								append(state.deactivated, pluginId),
								Ref.update(state.installed, (all) => all.filter(({ id }) => id !== pluginId)),
							]).pipe(Effect.asVoid),
				findByContentHash: ({ contentHash }) => {
					if (!input?.cached) {
						return Effect.succeed(null);
					}
					const cached = makeStoredPlugin(input.cachedManifest ?? fixtureManifest(), contentHash);
					return Ref.update(state.installed, (all) =>
						upsertBy(all, cached, (plugin) => plugin.packageId === cached.packageId),
					).pipe(Effect.as(cached));
				},
				persist: (plugin, identity) => {
					const { packageId } = plugin.manifest.metadata;
					const pluginId = identity.pluginId ?? `${packageId}-plugin-id`;
					const { scripts, ...revision } = plugin;
					const stored: StoredPlugin = {
						...revision,
						...identity,
						packageId,
						id: pluginId,
						status: "active",
						activationId: `${packageId}-activation`,
						scripts: scripts.map(toPluginScriptDescriptor),
					};
					return append(state.persisted, plugin).pipe(
						Effect.andThen(
							Ref.update(state.installed, (all) =>
								upsertBy(all, stored, (candidate) => candidate.packageId === packageId),
							),
						),
						Effect.as(pluginId),
					);
				},
			});
			const redisLayer = Layer.succeed(
				RedisService,
				makeRedisService({
					publish: (channel, message) =>
						input?.publishFailure === undefined
							? recordEvent("publish").pipe(
									Effect.andThen(append(state.published, { channel, message })),
									Effect.as(1),
								)
							: Effect.die(input.publishFailure),
				}),
			);
			return Layer.mergeAll(
				repository,
				Layer.mock(PluginInstallationRepository)({
					quarantinePackageIdentityConflicts: () =>
						Effect.gen(function* () {
							if (input?.quarantined?.length) {
								yield* recordEvent(
									`quarantine:${(yield* session.isTransactionActive) ? "transaction" : "root"}`,
								);
							}
							return input?.quarantined ?? [];
						}),
				}),
				Layer.succeed(PluginIngestionRetirement, {
					retire: () =>
						Effect.gen(function* () {
							yield* recordEvent(
								`retire:${(yield* session.isTransactionActive) ? "transaction" : "root"}`,
							);
						}),
				}),
				Layer.mock(DefinitionRepository)({
					readKernelSource: Effect.succeed(kernelDefinitionSource()),
				}),
				Layer.succeed(SystemPlugins, {
					sources: [],
					packageIds: new Set(
						input?.systemPluginNames?.size ? [fixtureManifest().metadata.packageId] : [],
					),
				}),
				Layer.mock(SandboxWorkflowReferenceRepository)({
					hasReferences: () =>
						recordEvent("workflow-reference").pipe(
							Effect.as(input?.hasWorkflowReferences ?? false),
						),
				}),
				Layer.succeed(PluginRevisionActivation, {
					activated: (pluginId) => append(state.activated, pluginId),
				}),
				Layer.effect(
					PluginCatalogInvalidator,
					Effect.gen(function* () {
						const redis = yield* RedisService;
						const publish = (channel: string, message: string) =>
							redis.publish(channel, message).pipe(
								Effect.asVoid,
								Effect.catchCause((cause) =>
									Effect.logError("plugin catalog publish failed", cause),
								),
							);
						return {
							recordAll: Effect.void,
							recordUser: () => Effect.void,
							deliverPending: () => Effect.void,
							all: publish(redisKeys.pluginCatalogChannel, "plugin-catalog-invalidated"),
							user: (userId: UserId) =>
								publish(
									redisKeys.pluginCatalogUserChannel,
									encodePluginCatalogInvalidatedMessage({ userId }),
								),
						};
					}),
				).pipe(Layer.provide(redisLayer)),
				Layer.succeed(FakeIngestionDependencies, {
					events: Ref.get(state.events),
					activated: Ref.get(state.activated),
					persisted: Ref.get(state.persisted),
					published: Ref.get(state.published),
					deactivated: Ref.get(state.deactivated),
					integrationFences: Ref.get(state.integrationFences),
					replaceInstalled: (plugin) => Ref.set(state.installed, [plugin]),
					setEntityReferences: (hasReferences) => Ref.set(state.hasEntityReferences, hasReferences),
					contention: {
						beginRound: Effect.flatMap(makeContentionRound, (round) => Ref.set(state.round, round)),
						exclusiveAcquired: Effect.flatMap(currentRound, ({ acquired }) =>
							Deferred.await(acquired),
						),
						sharedAttempted: Effect.flatMap(currentRound, ({ sharedAttempted }) =>
							Deferred.await(sharedAttempted),
						),
						allowInspection: Effect.flatMap(currentRound, ({ inspection }) =>
							Deferred.succeed(inspection, undefined),
						),
						releaseExclusive: Effect.gen(function* () {
							if (!(yield* Ref.getAndSet(state.exclusive, false))) {
								return;
							}
							yield* recordEvent("exclusive-released");
							yield* Deferred.succeed((yield* currentRound).released, undefined);
						}),
						registerWorkflowReference: Effect.gen(function* () {
							const round = yield* currentRound;
							yield* recordEvent("shared-attempt");
							yield* Deferred.succeed(round.sharedAttempted, undefined);
							if (yield* Ref.get(state.exclusive)) {
								yield* Deferred.await(round.released);
							}
							yield* recordEvent("shared-acquired");
							if (!(yield* Ref.get(state.active))) {
								return yield* new SandboxWorkflowReferenceRegistrationError({
									reason: "plugin-inactive",
									message: "Plugin 'fixture' is not active",
								});
							}
							yield* recordEvent("registered");
							return { status: "registered" as const };
						}),
					},
				}),
			);
		}),
	);
	return PluginIngestionService.layer.pipe(
		Layer.provideMerge(fakesLayer),
		Layer.provideMerge(stateLayer),
		Layer.provideMerge(Layer.merge(databaseLayer, pluginBackendCompilerPlatformLayer)),
	);
};

layer(makeLayer({}))((test) => {
	test.effect("normalizes precompiled scripts, content-addresses, persists, and publishes", () =>
		Effect.gen(function* () {
			const fake = yield* FakeIngestionDependencies;
			const ingestion = yield* PluginIngestionService;
			const source = yield* loadPluginSource(fixturePackageRoot(), fixtureManifest());
			const plugin = yield* ingestion.ingestSystemPlugin(source);

			expect(plugin.contentHash).toMatch(/^[a-f0-9]{64}$/);
			expect(plugin.scripts[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/);
			const [persistedPackage] = yield* fake.persisted;
			assert((yield* fake.persisted).length === 1 && persistedPackage);
			expect(persistedPackage.manifest).toEqual(plugin.manifest);
			expect(persistedPackage.contentHash).toBe(plugin.contentHash);
			expect(persistedPackage.scripts.map(toPluginScriptDescriptor)).toEqual(plugin.scripts);
			expect(plugin.manifest.hooks).toEqual(fixtureManifest().hooks);
			expect(yield* fake.published).toHaveLength(1);
			expect((yield* fake.published)[0]?.channel).toBe(redisKeys.pluginCatalogChannel);
			expect(yield* fake.activated).toEqual([plugin.id]);
			expect((yield* fake.events).filter((event) => event.startsWith("resolve-"))).toEqual([
				`resolve-environment:${plugin.id}`,
			]);
		}),
	);
});

layer(
	makeLayer({
		quarantined: [
			{ userId: "private-owner", id: "private-installation", pluginId: "private-plugin" },
		],
	}),
)((test) => {
	test.effect(
		"activates a system package while quarantining exact private claims before commit",
		() =>
			Effect.gen(function* () {
				const ingestion = yield* PluginIngestionService;
				const fake = yield* FakeIngestionDependencies;
				const source = yield* loadPluginSource(fixturePackageRoot(), fixtureManifest());
				const installed = yield* ingestion.ingestSystemPlugin(source);
				expect(installed.packageId).toBe(source.manifest.metadata.packageId);
				const events = yield* fake.events;
				expect(events).toContain("quarantine:transaction");
				expect(events).toContain("retire:root");
				expect(events.indexOf("quarantine:transaction")).toBeLessThan(events.indexOf("publish"));
				expect(events.indexOf("publish")).toBeLessThan(events.indexOf("retire:root"));
			}),
	);
});

layer(makeLayer({}))((test) => {
	test.effect("resolves system plugin environments once after batch synchronization", () =>
		Effect.gen(function* () {
			const fake = yield* FakeIngestionDependencies;
			const ingestion = yield* PluginIngestionService;
			const source = yield* loadPluginSource(fixturePackageRoot(), fixtureManifest());

			yield* ingestion.synchronizeSystemPlugins([source, source]);

			expect((yield* fake.events).filter((event) => event.startsWith("resolve-"))).toEqual([
				"resolve-all-environments",
			]);
		}),
	);
});

layer(makeLayer({}))((test) => {
	test.effect("preserves provider search options metadata through ingestion", () =>
		Effect.gen(function* () {
			const fake = yield* FakeIngestionDependencies;
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
					},
				],
				scripts: [
					...fixture.scripts,
					{
						kind: "provider" as const,
						...emptySandboxExecutionMetadata,
						name: "Fixture Provider Details",
						slug: "fixture.provider.details",
						providerSlug: "fixture.provider",
						providerOperation: "details" as const,
						entry: "backend/providers/fixture/provider/details.sandbox.ts",
					},
					{
						searchOptionsSchema,
						kind: "provider" as const,
						...emptySandboxExecutionMetadata,
						name: "Fixture Provider Search",
						slug: "fixture.provider.search",
						providerSlug: "fixture.provider",
						providerOperation: "search" as const,
						entry: "backend/providers/fixture/provider/search.sandbox.ts",
					},
				],
			};
			const source = yield* loadPluginSource(fixturePackageRoot(), manifest);
			const plugin = yield* ingestion.ingestSystemPlugin(source);
			const searchScript = plugin.scripts.find(({ slug }) => slug === "fixture.provider.search");

			expect(searchScript?.metadata).toMatchObject({ searchOptionsSchema });
			expect(
				(yield* fake.persisted)[0]?.scripts.find(({ slug }) => slug === "fixture.provider.search")
					?.metadata,
			).toMatchObject({ searchOptionsSchema });
		}),
	);
});

layer(makeLayer({ publishFailure: "lost install publication" }))((test) => {
	test.effect("returns a committed install when Redis publication fails", () =>
		Effect.gen(function* () {
			const fake = yield* FakeIngestionDependencies;
			const ingestion = yield* PluginIngestionService;
			const source = yield* loadPluginSource(fixturePackageRoot(), fixtureManifest());
			const plugin = yield* ingestion.ingestSystemPlugin(source);

			const [persistedPackage] = yield* fake.persisted;
			assert((yield* fake.persisted).length === 1 && persistedPackage);
			expect(persistedPackage.manifest).toEqual(plugin.manifest);
			expect(persistedPackage.contentHash).toBe(plugin.contentHash);
			expect(persistedPackage.scripts.map(toPluginScriptDescriptor)).toEqual(plugin.scripts);
		}),
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
				...emptySandboxExecutionMetadata,
				name: "Fixture User Bootstrap",
				slug: "fixture.user-bootstrap",
				entry: "backend/bootstrap/user-bootstrap.sandbox.ts",
			},
		],
	};
};

layer(makeLayer({}))((test) => {
	test.effect("accepts user bootstrap declarations through explicit system ingestion", () =>
		Effect.gen(function* () {
			const fake = yield* FakeIngestionDependencies;
			const ingestion = yield* PluginIngestionService;
			const manifest = userBootstrapManifest();
			const source = yield* loadPluginSource(fixturePackageRoot(), {
				...manifest,
				metadata: { ...manifest.metadata },
			});
			const plugin = yield* ingestion.ingestSystemPlugin(source);

			expect(plugin.manifest.userBootstrap).toEqual([
				{
					slug: "fixture",
					scriptSlug: "fixture.user-bootstrap",
					description: "Bootstrap fixture user data",
				},
			]);
			const [persistedPackage] = yield* fake.persisted;
			assert((yield* fake.persisted).length === 1 && persistedPackage);
			expect(persistedPackage.manifest).toEqual(plugin.manifest);
			expect(persistedPackage.contentHash).toBe(plugin.contentHash);
			expect(persistedPackage.scripts.map(toPluginScriptDescriptor)).toEqual(plugin.scripts);
		}),
	);
});

const installedExample = makeStoredPlugin(definitionOwnerManifest(), "example-source-hash");

layer(makeLayer({ initialInstalled: [installedExample] }))((test) => {
	test.effect("rejects hooks targeting schemas outside the authored manifest surface", () => {
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
		});
	});
});

const formatterOwner = makeStoredPlugin(formatterOwnerManifest(), "formatter-owner-source-hash");

layer(makeLayer({ initialInstalled: [formatterOwner] }))((test) => {
	test.effect("rejects a notification hook owned by another plugin", () => {
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
		});
	});
});

layer(makeLayer())((test) => {
	test.effect("rejects plugin signals that reference a kernel source-zero formatter", () => {
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
		});
	});
});

layer(makeLayer())((test) => {
	test.effect("rejects missing and non-automation notification formatters", () =>
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
			}),
		),
	);
});

layer(makeLayer())((test) => {
	test.effect("rejects plugin scripts that collide with kernel source zero", () => {
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
		});
	});
});

const danglingFormatterPlugin = (() => {
	const manifest = fixtureManifest();
	const signalSchema = manifest.signalSchemas[0];
	assert(signalSchema);
	return makeStoredPlugin(
		{
			...manifest,
			signalSchemas: [{ ...signalSchema, notificationHookSlug: "missing.notification" }],
		},
		"stored-source-hash",
	);
})();

layer(makeLayer({ initialInstalled: [danglingFormatterPlugin] }))((test) => {
	test.effect("refuses an active system set with a dangling notification formatter", () => {
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
		});
	});
});

const storedFixture = makeStoredPlugin(fixtureManifest(), "stored-source-hash");

layer(makeLayer({ initialInstalled: [storedFixture] }))((test) => {
	test.effect("lists active plugins and uninstalls without deleting historical scripts", () => {
		return Effect.gen(function* () {
			const fake = yield* FakeIngestionDependencies;
			const ingestion = yield* PluginIngestionService;

			expect(yield* ingestion.listPlugins()).toEqual([
				expect.objectContaining({ packageId: fixtureManifest().metadata.packageId }),
			]);

			const removed = yield* ingestion.uninstallPlugin(
				storedFixture.id,
				storedFixture.activationId,
			);
			expect(removed).toEqual({ pluginId: storedFixture.id });
			expect(yield* fake.deactivated).toEqual([storedFixture.id]);
			expect(yield* ingestion.listPlugins()).toEqual([]);
			expect(yield* fake.published).toEqual([
				expect.objectContaining({ channel: redisKeys.pluginCatalogChannel }),
			]);
		});
	});

	test.effect("returns the committed uninstall for a retry without removing a replacement", () =>
		Effect.gen(function* () {
			const fake = yield* FakeIngestionDependencies;
			const ingestion = yield* PluginIngestionService;
			const first = yield* ingestion.uninstallPlugin(storedFixture.id, storedFixture.activationId);
			const replacement = { ...storedFixture, activationId: "replacement-activation" };
			yield* fake.replaceInstalled(replacement);

			expect(
				yield* ingestion.uninstallPlugin(storedFixture.id, storedFixture.activationId),
			).toEqual(first);
			expect(yield* ingestion.listPlugins()).toHaveLength(1);
			expect(yield* fake.deactivated).toEqual([storedFixture.id]);
			const wrong = yield* Effect.exit(
				ingestion.uninstallPlugin(storedFixture.id, "unknown-activation"),
			);
			expect(failureOf(wrong)).toMatchObject({ _tag: "PluginNotFoundError" });
			expect(yield* ingestion.listPlugins()).toHaveLength(1);
		}),
	);
});

layer(
	makeLayer({ initialInstalled: [storedFixture], publishFailure: "lost uninstall publication" }),
)((test) => {
	test.effect("returns a committed uninstall when Redis publication fails", () => {
		return Effect.gen(function* () {
			const fake = yield* FakeIngestionDependencies;
			const ingestion = yield* PluginIngestionService;

			const removed = yield* ingestion.uninstallPlugin(
				storedFixture.id,
				storedFixture.activationId,
			);
			expect(removed).toEqual({ pluginId: storedFixture.id });
			expect(yield* fake.deactivated).toEqual([storedFixture.id]);
			expect(yield* ingestion.listPlugins()).toEqual([]);
		});
	});
});

layer(makeLayer({ hasWorkflowReferences: true, initialInstalled: [storedFixture] }))((test) => {
	test.effect("deactivates a plugin with queued work while retaining its immutable package", () => {
		return Effect.gen(function* () {
			const fake = yield* FakeIngestionDependencies;
			const ingestion = yield* PluginIngestionService;
			const removed = yield* ingestion.uninstallPlugin(
				storedFixture.id,
				storedFixture.activationId,
			);

			expect(removed).toEqual({ pluginId: storedFixture.id });
			expect(yield* fake.events).toEqual(["lock", "deactivate", "publish"]);
			expect(yield* fake.deactivated).toEqual([storedFixture.id]);
			expect(yield* fake.published).toEqual([
				{ message: "plugin-catalog-invalidated", channel: redisKeys.pluginCatalogChannel },
			]);
		});
	});
});

layer(makeLayer({ contendedLock: true, initialInstalled: [storedFixture] }))((test) => {
	test.effect("serializes workflow pin registration with refused and successful uninstall", () =>
		Effect.gen(function* () {
			const fake = yield* FakeIngestionDependencies;
			const ingestion = yield* PluginIngestionService;
			const { contention } = fake;
			yield* Effect.forEach([true, false], (hasExistingReference) =>
				Effect.gen(function* () {
					yield* contention.beginRound;
					yield* fake.setEntityReferences(hasExistingReference);
					const eventsBefore = (yield* fake.events).length;
					const events = Effect.map(fake.events, (all) => all.slice(eventsBefore));

					const uninstall = yield* Effect.forkChild(
						Effect.exit(
							ingestion.uninstallPlugin(storedFixture.id, storedFixture.activationId),
						).pipe(Effect.tap(contention.releaseExclusive)),
					);
					yield* contention.exclusiveAcquired;
					expect(yield* events).toEqual(["exclusive-acquired"]);

					const dispatch = yield* Effect.forkChild(
						Effect.exit(contention.registerWorkflowReference),
					);
					yield* contention.sharedAttempted;
					expect(yield* events).toEqual(["exclusive-acquired", "shared-attempt"]);

					yield* contention.allowInspection;
					const uninstallExit = yield* Fiber.join(uninstall);
					const dispatchExit = yield* Fiber.join(dispatch);

					if (hasExistingReference) {
						assertExitFails(
							uninstallExit,
							new PluginConflictError({
								reason: { code: "entity-referenced", pluginId: PluginId.make(storedFixture.id) },
							}),
						);
						expect(dispatchExit).toEqual(Exit.succeed({ status: "registered" }));
						expect(yield* events).toEqual([
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
						expect(yield* events).toEqual([
							"exclusive-acquired",
							"shared-attempt",
							"deactivated",
							"publish",
							"exclusive-released",
							"shared-acquired",
						]);
					}
				}),
			);
		}),
	);
});

layer(makeLayer({ hasEntityReferences: true, initialInstalled: [storedFixture] }))((test) => {
	test.effect("refuses uninstall while entities reference a declared schema", () => {
		return Effect.gen(function* () {
			const fake = yield* FakeIngestionDependencies;
			const ingestion = yield* PluginIngestionService;
			const exit = yield* Effect.exit(
				ingestion.uninstallPlugin(storedFixture.id, storedFixture.activationId),
			);

			expect(failureOf(exit)).toMatchObject({
				_tag: "PluginConflictError",
				reason: { code: "entity-referenced", pluginId: storedFixture.id },
			});
			expect(yield* fake.deactivated).toEqual([]);
		});
	});
});

layer(makeLayer({ hasIntegrationReferences: true, initialInstalled: [storedFixture] }))((test) => {
	test.effect("refuses uninstall while integrations are owned by the plugin", () => {
		return Effect.gen(function* () {
			const fake = yield* FakeIngestionDependencies;
			const ingestion = yield* PluginIngestionService;
			const exit = yield* Effect.exit(
				ingestion.uninstallPlugin(storedFixture.id, storedFixture.activationId),
			);

			assertExitFails(
				exit,
				new PluginConflictError({
					reason: { code: "integration-referenced", pluginId: PluginId.make(storedFixture.id) },
				}),
			);
			expect(yield* fake.integrationFences).toEqual([{ pluginId: storedFixture.id }]);
			expect(yield* fake.deactivated).toEqual([]);
		});
	});
});

const definitionOwner = makeStoredPlugin(fixtureManifest(), "owner-source-hash");
const hookDependent = makeStoredPlugin(
	dependentManifest("fixture-entity"),
	"dependent-source-hash",
);

layer(makeLayer({ initialInstalled: [definitionOwner, hookDependent] }))((test) => {
	test.effect("uninstalls independently of another package's same-name hook targets", () => {
		return Effect.gen(function* () {
			const fake = yield* FakeIngestionDependencies;
			const ingestion = yield* PluginIngestionService;
			expect(
				yield* ingestion.uninstallPlugin(storedFixture.id, storedFixture.activationId),
			).toEqual({ pluginId: storedFixture.id });
			expect(yield* fake.deactivated).toEqual([storedFixture.id]);
		});
	});
});

const notificationDependent = (() => {
	const manifest = fixtureManifest();
	const signalSchema = manifest.signalSchemas[0];
	assert(signalSchema);
	return makeStoredPlugin({ ...manifest, signalSchemas: [signalSchema] }, "dependent-source-hash");
})();

layer(makeLayer({ initialInstalled: [formatterOwner, notificationDependent] }))((test) => {
	test.effect(
		"uninstalls an unrelated formatter without affecting plugin-local notification hooks",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeIngestionDependencies;
				const ingestion = yield* PluginIngestionService;
				expect(
					yield* ingestion.uninstallPlugin(formatterOwner.id, formatterOwner.activationId),
				).toEqual({ pluginId: formatterOwner.id });
				expect(yield* fake.deactivated).toEqual([formatterOwner.id]);
				expect((yield* ingestion.listPlugins()).map(({ packageId }) => packageId)).toEqual([
					fixtureManifest().metadata.packageId,
				]);
			}),
	);
});

const relationshipDependent = makeStoredPlugin(
	relationshipDependentManifest("fixture-entity"),
	"dependent-source-hash",
);

layer(makeLayer({ initialInstalled: [definitionOwner, relationshipDependent] }))((test) => {
	test.effect(
		"uninstalls independently of another package's same-name relationship endpoints",
		() => {
			return Effect.gen(function* () {
				const fake = yield* FakeIngestionDependencies;
				const ingestion = yield* PluginIngestionService;
				expect(
					yield* ingestion.uninstallPlugin(storedFixture.id, storedFixture.activationId),
				).toEqual({ pluginId: storedFixture.id });
				expect(yield* fake.deactivated).toEqual([storedFixture.id]);
				expect((yield* ingestion.listPlugins()).map(({ packageId }) => packageId)).toEqual([
					relationshipDependent.packageId,
				]);
			});
		},
	);
});

layer(
	makeLayer({
		initialInstalled: [installedExample],
		systemPluginNames: new Set([installedExample.manifest.metadata.packageId]),
	}),
)((test) => {
	test.effect("refuses uninstall for a system plugin", () => {
		return Effect.gen(function* () {
			const ingestion = yield* PluginIngestionService;
			const exit = yield* Effect.exit(
				ingestion.uninstallPlugin(installedExample.id, installedExample.activationId),
			);

			expect(failureOf(exit)).toMatchObject({
				_tag: "PluginConflictError",
				reason: { code: "system-plugin", pluginId: installedExample.id },
			});
		});
	});
});

layer(makeLayer({ cached: true }))((test) => {
	test.effect("reuses a cached compiled package without persisting it again", () =>
		Effect.gen(function* () {
			const fake = yield* FakeIngestionDependencies;
			const ingestion = yield* PluginIngestionService;
			const source = yield* loadPluginSource(fixturePackageRoot(), fixtureManifest());
			const plugin = yield* ingestion.ingestSystemPlugin(source);

			expect(plugin.scripts[0]?.contentHash).toBe("cached-hash-fixture.automation");
			expect(yield* fake.persisted).toHaveLength(0);
			expect(yield* fake.events).toEqual([
				"lock",
				`resolve-environment:${fixtureManifest().metadata.packageId}-plugin-id`,
				"publish",
			]);
			expect(yield* fake.published).toEqual([
				expect.objectContaining({ channel: redisKeys.pluginCatalogChannel }),
			]);
		}),
	);
});

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
	metadata: { ...definitionOwnerManifest().metadata, packageId: testPluginPackageId() },
	httpRateLimits: [
		{
			requests: 2,
			intervalMs: 1_000,
			key: "catalog.shared",
			origins: ["https://database.example.com"],
		},
	],
};

layer(
	makeLayer({
		cached: true,
		cachedManifest,
		initialInstalled: [makeStoredPlugin(conflictingManifest, "database-source")],
	}),
)((test) => {
	test.effect("keeps same-name rate-limit declarations in independent packages", () => {
		return Effect.gen(function* () {
			const fake = yield* FakeIngestionDependencies;
			const ingestion = yield* PluginIngestionService;
			const source = yield* loadPluginSource(fixturePackageRoot(), cachedManifest);
			const installed = yield* ingestion.ingestSystemPlugin(source);
			expect(installed.packageId).toBe(cachedManifest.metadata.packageId);
			expect(yield* fake.published).toHaveLength(1);
		});
	});
});

layer(makeLayer())((test) => {
	test.effect("returns structured validation diagnostics", () => {
		const cases: ReadonlyArray<{ manifest: unknown; reasonCode: "validation-failed" }> = [
			{ manifest: {}, reasonCode: "validation-failed" },
			{
				reasonCode: "validation-failed",
				manifest: {
					...fixtureManifest(),
					metadata: { ...fixtureManifest().metadata, packageId: "bad" },
				},
			},
			{
				reasonCode: "validation-failed",
				manifest: {
					...fixtureManifest(),
					entitySchemas: [{ ...fixtureManifest().entitySchemas[0], slug: "item" }],
				},
			},
			{
				reasonCode: "validation-failed",
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
		];

		return Effect.forEach(cases, (testCase) =>
			Effect.gen(function* () {
				const ingestion = yield* PluginIngestionService;
				const exit = yield* Effect.exit(
					ingestion.ingestSystemPlugin({ manifest: testCase.manifest }),
				);
				const failure = failureOf(exit);
				expect(failure).toMatchObject({
					_tag: "PluginRequestError",
					reason: { code: testCase.reasonCode, diagnostics: expect.any(Array) },
				});
			}),
		);
	});
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

layer(makeLayer({}))((test) => {
	test.effect("preserves a precompiled client artifact without compiling client sources", () =>
		Effect.gen(function* () {
			const fake = yield* FakeIngestionDependencies;
			const ingestion = yield* PluginIngestionService;
			const source = yield* loadPluginSource(fixturePackageRoot(), clientManifest());
			const plugin = yield* ingestion.ingestSystemPlugin(source);

			assert(source.compiledClient);
			assert((yield* fake.persisted).length === 1);
			expect(plugin.contentHash).toMatch(/^[a-f0-9]{64}$/);
			expect((yield* fake.persisted)[0]?.compiledClient).toEqual(source.compiledClient);
			expect((yield* fake.persisted)[0]?.contentHash).toBe(plugin.contentHash);
		}),
	);
});

layer(makeLayer())((test) => {
	test.effect("rejects non-canonical plugin script entries as bad requests", () => {
		const manifest = fixtureManifest();
		const cases = [
			"",
			"/script.ts",
			"scripts\\script.ts",
			"scripts//script.ts",
			"scripts/./script.ts",
			"scripts/../script.ts",
		];

		return Effect.forEach(cases, (scriptEntry) =>
			Effect.gen(function* () {
				const ingestion = yield* PluginIngestionService;
				const source = yield* loadPluginSource(fixturePackageRoot(), manifest);
				const script = manifest.scripts[0];
				assert(script);
				const exit = yield* Effect.exit(
					ingestion.ingestSystemPlugin({
						manifest: { ...manifest, scripts: [{ ...script, entry: scriptEntry }] },
						compiledScripts: source.compiledScripts.map((compiled) =>
							Object.assign({}, compiled, { entry: scriptEntry }),
						),
					}),
				);
				expect(failureOf(exit)).toMatchObject({
					_tag: "PluginRequestError",
					reason: { code: "validation-failed" },
				});
			}),
		);
	});
});

const otherPlugin = makeStoredPlugin(
	{
		...fixtureManifest(),
		metadata: { ...fixtureManifest().metadata, packageId: testPluginPackageId() },
	},
	"existing-source-hash",
);

layer(makeLayer({ initialInstalled: [otherPlugin] }))((test) => {
	test.effect("accepts same-name scripts in another active package", () => {
		return Effect.gen(function* () {
			const ingestion = yield* PluginIngestionService;
			const source = yield* loadPluginSource(fixturePackageRoot(), fixtureManifest());
			const installed = yield* ingestion.ingestSystemPlugin(source);
			expect(installed.packageId).not.toBe(otherPlugin.packageId);
		});
	});
});
