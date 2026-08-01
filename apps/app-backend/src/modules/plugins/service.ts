import { PluginConflictError, PluginNotFoundError } from "@ryot/contract/modules/plugins/schemas";
import { PluginSlug } from "@ryot/contract/schema/brands";
import { stableStringify } from "@ryot/ts-utils/json";
import { Cause, Context, Effect, FiberSet, Layer, Semaphore } from "effect";

import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import { kernelDefinitionSource, kernelScripts } from "#modules/definition-registry/kernel-source";
import { SandboxWorkflowReferenceRepository } from "#modules/sandbox/workflow-reference-repository";

import { bootConfiguredPluginSlugs } from "./boot-sources";
import { PluginLoader, type PluginRegistryEntry } from "./loader";
import {
	compilePluginPackage,
	pluginSourceHash,
	structurePluginFailure,
	validationDiagnostics,
} from "./pipeline";
import { PluginRepository } from "./repository";
import { validateAdditiveSchemaEvolution } from "./schema-evolution";
import { ScriptGarbageCollector } from "./script-garbage-collector";
import type { NormalizedPlugin, PluginSource } from "./types";
import {
	decodePluginManifest,
	PluginValidationError,
	validateIntegrationProviderSettingsSchemas,
	validateImportSourceInputSchemas,
	validatePluginExecutableScripts,
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

			const ingestPluginUnlocked = Effect.fn("PluginIngestionService.ingestPluginUnlocked")(
				function* (source: PluginSource, trusted: boolean) {
					const manifest = yield* decodePluginManifest(source.manifest);
					if (manifest.userBootstrap.length > 0 && !trusted) {
						return yield* new PluginValidationError({
							issues: ["User bootstrap declarations are allowed only for trusted system plugins"],
						});
					}
					const files = source.files;
					yield* validatePluginSourcePaths(files, manifest.scripts);
					const sourceHash = pluginSourceHash(manifest, files);
					const slug = manifest.metadata.slug;
					const existing = loader.getSnapshot().plugins[slug];
					const candidate = {
						slug,
						sourceHash,
						scripts: [],
						ownerId: null,
						sourceFiles: files,
						scope: "system" as const,
						id: existing?.id ?? `pending:${slug}`,
						manifest: { ...manifest, httpRateLimits: [] },
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

					const normalized = yield* compilePluginPackage({ files, manifest, sourceHash });
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
									const entry = {
										...normalized,
										slug,
										id: pluginId,
										ownerId: null,
										scope: "system" as const,
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
				},
			);
			const ingestPlugin = Effect.fn("PluginIngestionService.ingestPlugin")(
				(source: PluginSource) =>
					mutationLock.withPermits(1)(
						ingestPluginUnlocked(source, false).pipe(structurePluginFailure),
					),
			);
			const ingestTrustedPlugin = Effect.fn("PluginIngestionService.ingestTrustedPlugin")(
				(source: PluginSource) =>
					mutationLock.withPermits(1)(
						ingestPluginUnlocked(source, true).pipe(structurePluginFailure),
					),
			);

			const listPlugins = Effect.fn("PluginIngestionService.listPlugins")(function* () {
				const plugins = yield* repository.list();
				return plugins.map(toSystemPluginItem);
			});

			const installPlugin = Effect.fn("PluginIngestionService.installPlugin")(function* (
				source: PluginSource,
			) {
				return toSystemPluginItem(yield* ingestPlugin(source));
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
								if (bootConfiguredPluginSlugs.has(slug)) {
									return yield* new PluginConflictError({
										reason: { code: "boot-configured", pluginSlug },
									});
								}
								if (yield* workflowReferences.hasReferences(plugin.id)) {
									return yield* new PluginConflictError({
										reason: { code: "workflow-referenced", pluginSlug },
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
				ingestPlugin,
				installPlugin,
				uninstallPlugin,
				ingestTrustedPlugin,
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
			const runFork = yield* FiberSet.makeRuntime();
			const subscriber = redis.client.duplicate();
			const ingestion = yield* PluginIngestionService;
			const rebuildLock = yield* Semaphore.make(1);
			const channel = redisKeys.pluginRegistryChannel;
			const onMessage = (incoming: string) => {
				runFork(
					rebuildLock
						.withPermits(1)(handlePluginRegistryInvalidation(incoming, ingestion))
						.pipe(Effect.catchCause((cause) => Effect.logError(cause))),
				);
			};
			yield* runPluginRegistryReconciliation(
				Effect.sleep(PLUGIN_REGISTRY_RECONCILIATION_INTERVAL),
				ingestion,
			).pipe(Effect.forkScoped);
			subscriber.on("message", onMessage);
			yield* Effect.tryPromise(() => subscriber.subscribe(channel)).pipe(Effect.orDie);
			yield* Effect.addFinalizer(() =>
				Effect.sync(() => subscriber.removeAllListeners()).pipe(
					Effect.andThen(Effect.tryPromise(() => subscriber.quit()).pipe(Effect.ignore)),
				),
			);
			return { subscribed: true as const };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
