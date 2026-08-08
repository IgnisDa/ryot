import { decodePluginCatalogInvalidatedMessage } from "@ryot/contract/modules/plugins/contract";
import { PluginConflictError, PluginNotFoundError } from "@ryot/contract/modules/plugins/schemas";
import { PluginSlug } from "@ryot/contract/schema/brands";
import { stableStringify } from "@ryot/ts-utils/json";
import { Cause, Context, Effect, FiberSet, Layer, Result, Semaphore } from "effect";

import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import { kernelDefinitionSource, kernelScripts } from "#modules/definition-registry/kernel-source";
import { ClientPluginCompiler } from "#modules/plugins/client-plugin-compiler";
import { SandboxWorkflowReferenceRepository } from "#modules/sandbox/workflow-reference-repository";

import { PluginCatalogHub } from "./catalog-events";
import { PluginLoader, type PluginRegistryEntry } from "./loader";
import {
	compilePluginPackage,
	normalizePluginSource,
	structurePluginFailure,
	validationDiagnostics,
} from "./pipeline";
import { PluginRepository } from "./repository";
import { validateAdditiveSchemaEvolution } from "./schema-evolution";
import { ScriptGarbageCollector } from "./script-garbage-collector";
import { SystemPlugins } from "./system";
import type { NormalizedPlugin, PluginSource } from "./types";
import {
	PluginValidationError,
	validateIntegrationProviderSettingsSchemas,
	validateImportSourceInputSchemas,
	validatePluginExecutableScripts,
	validatePluginManifestPolicy,
	validatePluginManifestReferences,
	validatePluginSourcePaths,
	validateSignalSchemaFormatterReferences,
} from "./validation";

const PLUGIN_REGISTRY_RECONCILIATION_INTERVAL = "30 seconds";

const registryFingerprint = (
	plugins: ReadonlyArray<Pick<NormalizedPlugin, "manifest" | "sourceHash">>,
) =>
	stableStringify(
		plugins
			.map(({ manifest, sourceHash }) => [manifest.metadata.slug, sourceHash] as const)
			.sort(([left], [right]) => left.localeCompare(right)),
	);

const toSystemPluginItem = (plugin: Pick<NormalizedPlugin, "manifest" | "sourceHash">) => ({
	...plugin.manifest.metadata,
	sourceHash: plugin.sourceHash,
	slug: PluginSlug.make(plugin.manifest.metadata.slug),
});

export class PluginIngestionService extends Context.Service<PluginIngestionService>()(
	"PluginIngestionService",
	{
		make: Effect.gen(function* () {
			const redis = yield* RedisService;
			const loader = yield* PluginLoader;
			const database = yield* Database;
			const repository = yield* PluginRepository;
			const systemPlugins = yield* SystemPlugins;
			const clientCompiler = yield* ClientPluginCompiler;
			const scriptGarbageCollector = yield* ScriptGarbageCollector;
			const mutationLock = yield* Semaphore.make(1);
			const workflowReferences = yield* SandboxWorkflowReferenceRepository;
			const kernelSignalSlugs = new Set(
				kernelDefinitionSource().signalSchemas.map(({ slug }) => slug),
			);
			const validateSnapshot = Effect.fn("PluginIngestionService.validateSnapshot")(function* (
				snapshot: ReturnType<PluginLoader["Service"]["getSnapshot"]>,
				validateCompiledScripts = true,
			) {
				const plugins = Object.values(snapshot.plugins);
				yield* validateSignalSchemaFormatterReferences(
					snapshot.definitions,
					plugins.flatMap(({ manifest }) => manifest.scripts),
					kernelScripts,
					kernelSignalSlugs,
				);
				yield* Effect.forEach(
					plugins,
					(plugin) =>
						validatePluginManifestReferences(plugin.manifest, snapshot.definitions).pipe(
							Effect.andThen(validateIntegrationProviderSettingsSchemas(plugin.manifest)),
							Effect.andThen(validateImportSourceInputSchemas(plugin.manifest)),
							Effect.andThen(
								validateCompiledScripts ? validatePluginExecutableScripts(plugin) : Effect.void,
							),
						),
					{ discard: true },
				);
			});

			const rebuildUnlocked = Effect.fn("PluginIngestionService.rebuildUnlocked")(function* () {
				const snapshot = yield* mapDatabaseErrors(
					database.transaction((transaction) =>
						Effect.gen(function* () {
							yield* repository.lockIngestion();
							const plugins = yield* repository.list();
							const nextSnapshot = yield* Effect.try({
								try: () => loader.previewAll(plugins),
								catch: (error) => new PluginValidationError({ issues: [String(error)] }),
							});
							yield* validateSnapshot(nextSnapshot);
							return nextSnapshot;
						}).pipe(Effect.provideService(Database, transaction)),
					),
				);
				loader.replace(snapshot);
				yield* scriptGarbageCollector.collect();
				return snapshot;
			});
			const rebuild = Effect.fn("PluginIngestionService.rebuild")(() =>
				mutationLock.withPermits(1)(Effect.uninterruptible(rebuildUnlocked())),
			);
			const reconcile = Effect.fn("PluginIngestionService.reconcile")(() =>
				mutationLock.withPermits(1)(
					Effect.gen(function* () {
						const installed = yield* repository.list();
						const loaded = Object.values(loader.getSnapshot().plugins);
						if (registryFingerprint(installed) === registryFingerprint(loaded)) {
							return false;
						}
						yield* Effect.uninterruptible(rebuildUnlocked());
						return true;
					}),
				),
			);
			const publishInvalidation = Effect.fn("PluginIngestionService.publishInvalidation")(
				(message: string) =>
					redis
						.publish(redisKeys.pluginRegistryChannel, message)
						.pipe(
							Effect.catchCause((cause) =>
								Cause.hasInterrupts(cause)
									? Effect.failCause(cause)
									: Effect.logError("plugin registry invalidation publish failed", cause),
							),
						),
			);

			const ingestSystemPluginUnlocked = Effect.fn(
				"PluginIngestionService.ingestSystemPluginUnlocked",
			)(function* (source: PluginSource) {
				const { files, manifest, sourceHash } = yield* normalizePluginSource(source);
				yield* validatePluginManifestPolicy(manifest, { scope: "system" });
				yield* validatePluginSourcePaths(files, manifest.scripts);
				const slug = manifest.metadata.slug;
				const existing = loader.getSnapshot().plugins[slug];
				const candidate = {
					slug,
					manifest,
					sourceHash,
					scripts: [],
					ownerId: null,
					scope: "system" as const,
					clientArtifactHash: null,
					id: existing?.id ?? `pending:${slug}`,
				} satisfies PluginRegistryEntry;
				const prospectiveSnapshot = yield* Effect.try({
					try: () => loader.preview(candidate),
					catch: (error) => new PluginValidationError({ issues: [String(error)] }),
				});
				yield* validateSnapshot(prospectiveSnapshot, false);

				const cached = yield* repository.findBySourceHash({
					slug,
					sourceHash,
					ownerId: null,
					scope: "system",
				});
				if (cached) {
					const committed = yield* Effect.uninterruptible(
						mapDatabaseErrors(
							database.transaction((transaction) =>
								Effect.gen(function* () {
									yield* repository.lockIngestion();
									const installed = yield* repository.list();
									const authoritative = installed.find(
										(plugin) => plugin.slug === slug && plugin.sourceHash === sourceHash,
									);
									if (!authoritative) {
										return null;
									}
									const snapshot = yield* Effect.try({
										try: () => loader.previewAll(installed),
										catch: (error) => new PluginValidationError({ issues: [String(error)] }),
									});
									yield* validateSnapshot(snapshot);
									return { plugin: authoritative, snapshot };
								}).pipe(Effect.provideService(Database, transaction)),
							),
						).pipe(
							Effect.tap((result) =>
								result ? Effect.sync(() => loader.replace(result.snapshot)) : Effect.void,
							),
						),
					);
					if (committed) {
						yield* publishInvalidation(stableStringify({ slug, sourceHash }));
						return committed.plugin;
					}
				}

				const normalized = yield* compilePluginPackage({ files, manifest, sourceHash }).pipe(
					Effect.provideService(ClientPluginCompiler, clientCompiler),
				);
				const stored = yield* Effect.uninterruptible(
					mapDatabaseErrors(
						database.transaction((transaction) =>
							Effect.gen(function* () {
								yield* repository.lockIngestion();
								const installed = yield* repository.list();
								const previous = installed.find((plugin) => plugin.slug === slug);
								if (previous) {
									yield* validateAdditiveSchemaEvolution(previous.manifest, manifest);
								}
								const pluginId = yield* repository.persist(normalized, {
									slug,
									ownerId: null,
									scope: "system",
								});
								const { clientArtifact, files: _files, ...revision } = normalized;
								const entry = {
									...revision,
									slug,
									id: pluginId,
									ownerId: null,
									scope: "system" as const,
									clientArtifactHash: clientArtifact?.hash ?? null,
								} satisfies PluginRegistryEntry;
								const nextInstalled = [
									...installed.filter((plugin) => plugin.slug !== slug),
									entry,
								];
								const snapshot = yield* Effect.try({
									try: () => loader.previewAll(nextInstalled),
									catch: (error) => new PluginValidationError({ issues: [String(error)] }),
								});
								yield* validateSnapshot(snapshot);
								return { entry, snapshot };
							}).pipe(Effect.provideService(Database, transaction)),
						),
					).pipe(Effect.tap(({ snapshot }) => Effect.sync(() => loader.replace(snapshot)))),
				);
				yield* publishInvalidation(stableStringify({ slug, sourceHash }));
				return stored.entry;
			});
			const ingestSystemPlugin = Effect.fn("PluginIngestionService.ingestSystemPlugin")(
				(source: PluginSource) =>
					mutationLock.withPermits(1)(
						ingestSystemPluginUnlocked(source).pipe(structurePluginFailure),
					),
			);

			const listPlugins = Effect.fn("PluginIngestionService.listPlugins")(function* () {
				const plugins = yield* repository.list();
				return plugins.map(toSystemPluginItem);
			});

			const installPlugin = Effect.fn("PluginIngestionService.installPlugin")(function* (
				source: PluginSource,
			) {
				return toSystemPluginItem(yield* ingestSystemPlugin(source));
			});

			const uninstallPluginUnlocked = Effect.fn("PluginIngestionService.uninstallPluginUnlocked")(
				function* (slug: string) {
					const pluginSlug = PluginSlug.make(slug);
					const result = yield* mapDatabaseErrors(
						database.transaction((transaction) =>
							Effect.gen(function* () {
								yield* repository.lockIngestion();
								const installed = yield* repository.list();
								const plugin = installed.find((candidate) => candidate.slug === slug);
								if (!plugin) {
									return yield* new PluginNotFoundError({
										reason: { code: "plugin-not-found", pluginSlug },
									});
								}
								if (systemPlugins.slugs.has(slug)) {
									return yield* new PluginConflictError({
										reason: { code: "boot-configured", pluginSlug },
									});
								}
								if (yield* repository.hasIntegrationReferences({ pluginId: plugin.id })) {
									return yield* new PluginConflictError({
										reason: { code: "integration-referenced", pluginSlug },
									});
								}
								const schemaSlugs = plugin.manifest.entitySchemas.map(
									({ slug: entitySchemaSlug }) => entitySchemaSlug,
								);
								if (
									yield* repository.hasEntityReferences({
										pluginId: plugin.id,
										entitySchemaSlugs: schemaSlugs,
									})
								) {
									return yield* new PluginConflictError({
										reason: { code: "entity-referenced", pluginSlug },
									});
								}
								if (yield* repository.hasDefinitionReferences(plugin.id)) {
									return yield* new PluginConflictError({
										reason: { code: "entity-referenced", pluginSlug },
									});
								}
								if (yield* workflowReferences.hasReferences(plugin.id)) {
									return yield* new PluginConflictError({
										reason: { code: "workflow-referenced", pluginSlug },
									});
								}
								const remaining = installed.filter((candidate) => candidate.slug !== slug);
								const snapshot = yield* Effect.try({
									try: () => loader.previewAll(remaining),
									catch: (error) =>
										new PluginConflictError({
											reason: {
												pluginSlug,
												code: "definition-referenced",
												diagnostics: validationDiagnostics(
													new PluginValidationError({ issues: [String(error)] }),
												),
											},
										}),
								});
								const validateAndCatch = validateSnapshot(snapshot).pipe(
									Effect.as(null),
									Effect.catchTag("PluginValidationError", (error) => Effect.succeed(error)),
								);
								const dangling = yield* validateAndCatch;
								if (dangling) {
									return yield* new PluginConflictError({
										reason: {
											pluginSlug,
											code: "definition-referenced",
											diagnostics: validationDiagnostics(dangling),
										},
									});
								}
								yield* repository.deactivate(plugin.id);
								return { plugin, snapshot };
							}).pipe(Effect.provideService(Database, transaction)),
						),
					);
					loader.replace(result.snapshot);
					yield* publishInvalidation(stableStringify({ action: "uninstall", slug }));
					return toSystemPluginItem(result.plugin);
				},
			);
			const uninstallPlugin = Effect.fn("PluginIngestionService.uninstallPlugin")((slug: string) =>
				mutationLock.withPermits(1)(Effect.uninterruptible(uninstallPluginUnlocked(slug))),
			);

			return {
				rebuild,
				reconcile,
				listPlugins,
				installPlugin,
				uninstallPlugin,
				ingestSystemPlugin,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export const handlePluginRegistryInvalidation = (
	incoming: string,
	ingestion: Pick<PluginIngestionService["Service"], "rebuild">,
) =>
	incoming === redisKeys.pluginRegistryChannel
		? ingestion.rebuild().pipe(Effect.asVoid)
		: Effect.void;

export const runPluginRegistryReconciliation = (
	tick: Effect.Effect<void>,
	ingestion: Pick<PluginIngestionService["Service"], "reconcile">,
) =>
	tick.pipe(
		Effect.andThen(
			ingestion
				.reconcile()
				.pipe(
					Effect.catchCause((cause) =>
						Cause.hasInterrupts(cause)
							? Effect.failCause(cause)
							: Effect.logError("plugin registry reconciliation failed", cause),
					),
				),
		),
		Effect.forever,
	);

export class PluginInvalidationSubscriber extends Context.Service<PluginInvalidationSubscriber>()(
	"PluginInvalidationSubscriber",
	{
		make: Effect.gen(function* () {
			const redis = yield* RedisService;
			const hub = yield* PluginCatalogHub;
			const runFork = yield* FiberSet.makeRuntime();
			const subscriber = redis.client.duplicate();
			const ingestion = yield* PluginIngestionService;
			const rebuildLock = yield* Semaphore.make(1);
			const channels = [redisKeys.pluginCatalogUserChannel, redisKeys.pluginRegistryChannel];
			const dispatch = Effect.fn("PluginInvalidationSubscriber.dispatch")(function* (
				incoming: string,
				message: string,
			) {
				if (incoming === redisKeys.pluginRegistryChannel) {
					yield* rebuildLock
						.withPermits(1)(ingestion.rebuild())
						.pipe(Effect.ensuring(hub.broadcastAll()));
					return;
				}
				if (incoming !== redisKeys.pluginCatalogUserChannel) {
					return;
				}
				const decoded = decodePluginCatalogInvalidatedMessage(message);
				if (Result.isSuccess(decoded)) {
					yield* hub.broadcast(decoded.success.userId);
				}
			});
			const recover = Effect.tryPromise(() => subscriber.subscribe(...channels)).pipe(
				Effect.andThen(hub.broadcastAll()),
				Effect.catchCause((cause) =>
					Effect.logError("plugin invalidation subscription failed", cause),
				),
			);
			yield* runPluginRegistryReconciliation(
				Effect.sleep(PLUGIN_REGISTRY_RECONCILIATION_INTERVAL),
				ingestion,
			).pipe(Effect.forkScoped);
			subscriber.on("message", (incoming, message) =>
				runFork(dispatch(incoming, message).pipe(Effect.catchCause(Effect.logError))),
			);
			subscriber.on("ready", () => runFork(recover));
			yield* recover;
			yield* Effect.addFinalizer(() =>
				Effect.sync(() => subscriber.removeAllListeners()).pipe(
					Effect.andThen(Effect.tryPromise(() => subscriber.quit()).pipe(Effect.ignore)),
				),
			);
			return { dispatch, recover, subscribed: true as const };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
