import { badRequest, conflict, notFound } from "@ryot/contract/errors";
import type { PluginListItem } from "@ryot/contract/modules/plugins/schemas";
import type { PluginManifest } from "@ryot/plugin-kit/manifest";
import { compilePluginSandboxSourceEntries } from "@ryot/sandbox-compiler/plugins";
import { stableStringify } from "@ryot/ts-utils/json";
import { Cause, Effect, FiberSet } from "effect";

import { DbRunner, TransactionRunner } from "#lib/infrastructure/db/service";
import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import { kernelDefinitionSource, kernelScripts } from "#modules/definition-registry/kernel-source";
import { SandboxWorkflowReferenceRepository } from "#modules/sandbox/workflow-reference-repository";

import { bootConfiguredPluginSlugs } from "./boot-sources";
import { PluginLoader } from "./loader";
import { PluginRepository } from "./repository";
import type { SchemaEvolutionError } from "./schema-evolution";
import { validateAdditiveSchemaEvolution } from "./schema-evolution";
import { ScriptGarbageCollector } from "./script-garbage-collector";
import type { NormalizedPlugin, PluginScriptMetadata, PluginSource } from "./types";
import {
	decodePluginManifest,
	PluginValidationError,
	validateIntegrationProviderSettingsSchemas,
	validatePluginExecutableScripts,
	validatePluginManifestReferences,
	validatePluginSourcePaths,
	validateSignalSchemaFormatterReferences,
} from "./validation";

const digest = (value: string) => new Bun.CryptoHasher("sha256").update(value).digest("hex");

const PLUGIN_REGISTRY_RECONCILIATION_INTERVAL = "30 seconds";

const registryFingerprint = (
	plugins: ReadonlyArray<Pick<NormalizedPlugin, "manifest" | "sourceHash">>,
) =>
	stableStringify(
		plugins
			.map(({ manifest, sourceHash }) => [manifest.metadata.slug, sourceHash] as const)
			.sort(([left], [right]) => left.localeCompare(right)),
	);

const declaredScriptMetadata = (
	script: PluginManifest["scripts"][number],
): PluginScriptMetadata => {
	if (script.kind === "script" || script.kind === "activity") {
		return {
			slug: script.slug,
			name: script.name,
			kind: script.kind,
			capabilities: script.capabilities,
			requiredPluginConfigKeys: script.requiredPluginConfigKeys,
			requiredSystemConfigKeys: script.requiredSystemConfigKeys,
			...(script.providerSlug ? { providerSlug: script.providerSlug } : {}),
		};
	}
	if (script.kind === "operation" || script.kind === "automation") {
		return {
			slug: script.slug,
			name: script.name,
			kind: script.kind,
			capabilities: script.capabilities,
			requiredPluginConfigKeys: script.requiredPluginConfigKeys,
			requiredSystemConfigKeys: script.requiredSystemConfigKeys,
		};
	}
	if (script.kind === "workflow") {
		return {
			slug: script.slug,
			name: script.name,
			kind: "workflow",
			capabilities: script.capabilities,
			requiredPluginConfigKeys: script.requiredPluginConfigKeys,
			requiredSystemConfigKeys: script.requiredSystemConfigKeys,
		};
	}
	return {
		slug: script.slug,
		name: script.name,
		kind: "provider",
		capabilities: script.capabilities,
		providerSlug: script.providerSlug,
		providerOperation: script.providerOperation,
		requiredPluginConfigKeys: script.requiredPluginConfigKeys,
		requiredSystemConfigKeys: script.requiredSystemConfigKeys,
	};
};

const compiledScriptMetadata = (script: PluginManifest["scripts"][number]) => {
	if (script.kind === "script" || script.kind === "activity") {
		const { entry: _entry, providerSlug: _providerSlug, ...compiledMetadata } = script;
		return compiledMetadata;
	}
	if (script.kind !== "provider") {
		return declaredScriptMetadata(script);
	}
	const {
		entry: _entry,
		providerSlug: _providerSlug,
		providerOperation: _providerOperation,
		...compiledMetadata
	} = script;
	return compiledMetadata;
};

const toListItem = (plugin: NormalizedPlugin): PluginListItem => ({
	...plugin.manifest.metadata,
	sourceHash: plugin.sourceHash,
});

const validationMessage = (error: PluginValidationError | SchemaEvolutionError) =>
	error.issues
		.map((issue) => (typeof issue === "string" ? issue : `${issue.code}: ${issue.path}`))
		.join("; ");

export class PluginIngestionService extends Effect.Service<PluginIngestionService>()(
	"PluginIngestionService",
	{
		effect: Effect.gen(function* () {
			const redis = yield* RedisService;
			const runWithDb = yield* DbRunner;
			const loader = yield* PluginLoader;
			const repository = yield* PluginRepository;
			const scriptGarbageCollector = yield* ScriptGarbageCollector;
			const runTransaction = yield* TransactionRunner;
			const mutationLock = yield* Effect.makeSemaphore(1);
			const workflowReferences = yield* SandboxWorkflowReferenceRepository;
			const kernelSignalSlugs = new Set(
				kernelDefinitionSource().signalSchemas.map(({ slug }) => slug),
			);
			const validateSnapshot = Effect.fn("PluginIngestionService.validateSnapshot")(function* (
				snapshot: ReturnType<PluginLoader["getSnapshot"]>,
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
							Effect.andThen(
								validateCompiledScripts ? validatePluginExecutableScripts(plugin) : Effect.void,
							),
						),
					{ discard: true },
				);
			});

			const rebuildUnlocked = Effect.fn("PluginIngestionService.rebuildUnlocked")(function* () {
				const snapshot = yield* runTransaction(
					Effect.gen(function* () {
						yield* repository.lockIngestion();
						const plugins = yield* repository.list();
						const nextSnapshot = yield* Effect.try({
							try: () => loader.previewAll(plugins),
							catch: (error) => new PluginValidationError({ issues: [String(error)] }),
						});
						yield* validateSnapshot(nextSnapshot);
						loader.replace(nextSnapshot);
						return nextSnapshot;
					}),
				);
				yield* scriptGarbageCollector.collect();
				return snapshot;
			});
			const rebuild = Effect.fn("PluginIngestionService.rebuild")(() =>
				mutationLock.withPermits(1)(Effect.uninterruptible(rebuildUnlocked())),
			);
			const reconcile = Effect.fn("PluginIngestionService.reconcile")(() =>
				mutationLock.withPermits(1)(
					Effect.gen(function* () {
						const installed = yield* runWithDb(repository.list());
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
							Effect.catchAllCause((cause) =>
								Cause.isInterrupted(cause)
									? Effect.failCause(cause)
									: Effect.logError("plugin registry invalidation publish failed", cause),
							),
						),
			);

			const ingestPluginUnlocked = Effect.fn("PluginIngestionService.ingestPluginUnlocked")(
				function* (source: PluginSource, trusted: boolean) {
					const manifest = yield* decodePluginManifest(source.manifest);
					if (
						manifest.userBootstrap.length > 0 &&
						(!trusted || !bootConfiguredPluginSlugs.has(manifest.metadata.slug))
					) {
						return yield* new PluginValidationError({
							issues: [
								"User bootstrap declarations are allowed only for boot-configured trusted plugins",
							],
						});
					}
					const files = source.files;
					yield* validatePluginSourcePaths(files, manifest.scripts);
					const sourceHash = digest(stableStringify({ files, manifest }));
					const candidate = { manifest, sourceHash, scripts: [] } satisfies NormalizedPlugin;
					const prospectiveSnapshot = yield* Effect.try({
						try: () => loader.preview(candidate),
						catch: (error) => new PluginValidationError({ issues: [String(error)] }),
					});
					yield* validateSnapshot(prospectiveSnapshot, false);

					const cached = yield* runWithDb(
						repository.findBySourceHash({ slug: manifest.metadata.slug, sourceHash }),
					);
					if (cached) {
						const snapshot = yield* Effect.try({
							try: () => loader.preview(cached),
							catch: (error) => new PluginValidationError({ issues: [String(error)] }),
						});
						yield* validateSnapshot(snapshot);
						loader.replace(snapshot);
						yield* publishInvalidation(
							stableStringify({ slug: manifest.metadata.slug, sourceHash }),
						);
						return cached;
					}

					const compilerScripts = manifest.scripts.map((script) => {
						if (script.kind === "script" || script.kind === "activity") {
							const { providerSlug, ...genericScript } = script;
							return providerSlug ? { ...genericScript, providerSlug } : genericScript;
						}
						return script;
					});
					const compiled = yield* compilePluginSandboxSourceEntries(files, compilerScripts);
					const compiledByEntry = new Map(compiled.map((script) => [script.entry, script]));
					const scripts = yield* Effect.forEach(manifest.scripts, (script) => {
						const output = compiledByEntry.get(script.entry);
						if (!output) {
							return Effect.fail(
								new PluginValidationError({
									issues: [`Compiler returned no output for ${script.entry}`],
								}),
							);
						}
						const metadata = declaredScriptMetadata(script);
						if (
							stableStringify(compiledScriptMetadata(script)) !==
							stableStringify(output.compiled.manifest)
						) {
							return Effect.fail(
								new PluginValidationError({
									issues: [`Declared script metadata does not match ${script.entry}`],
								}),
							);
						}
						return Effect.succeed({
							slug: script.slug,
							name: script.name,
							entry: script.entry,
							source: output.source,
							compiledFormat: output.compiled.format,
							compiledCode: output.compiled.javascript,
							contentHash: digest(output.compiled.javascript),
							metadata,
						});
					});
					const normalized = { manifest, scripts, sourceHash } satisfies NormalizedPlugin;
					yield* Effect.uninterruptible(
						runTransaction(
							Effect.gen(function* () {
								yield* repository.lockIngestion();
								const installed = yield* repository.list();
								const previous = installed.find(
									(plugin) => plugin.manifest.metadata.slug === manifest.metadata.slug,
								);
								if (previous) {
									yield* validateAdditiveSchemaEvolution(previous.manifest, manifest);
								}
								const nextInstalled = [
									...installed.filter(
										(plugin) => plugin.manifest.metadata.slug !== manifest.metadata.slug,
									),
									normalized,
								];
								const snapshot = yield* Effect.try({
									try: () => loader.previewAll(nextInstalled),
									catch: (error) => new PluginValidationError({ issues: [String(error)] }),
								});
								yield* validateSnapshot(snapshot);
								yield* repository.persist(normalized);
								return snapshot;
							}),
						).pipe(Effect.tap((snapshot) => Effect.sync(() => loader.replace(snapshot)))),
					);
					yield* publishInvalidation(stableStringify({ slug: manifest.metadata.slug, sourceHash }));
					return normalized;
				},
			);
			const ingestPlugin = Effect.fn("PluginIngestionService.ingestPlugin")(
				(source: PluginSource) =>
					mutationLock.withPermits(1)(
						ingestPluginUnlocked(source, false).pipe(
							Effect.catchTags({
								SchemaEvolutionError: (error) => Effect.fail(badRequest(validationMessage(error))),
								PluginValidationError: (error) => Effect.fail(badRequest(validationMessage(error))),
								SandboxCompilerFailure: (error) => Effect.fail(badRequest(error.message)),
							}),
						),
					),
			);
			const ingestTrustedPlugin = Effect.fn("PluginIngestionService.ingestTrustedPlugin")(
				(source: PluginSource) =>
					mutationLock.withPermits(1)(
						ingestPluginUnlocked(source, true).pipe(
							Effect.catchTags({
								SchemaEvolutionError: (error) => Effect.fail(badRequest(validationMessage(error))),
								PluginValidationError: (error) => Effect.fail(badRequest(validationMessage(error))),
								SandboxCompilerFailure: (error) => Effect.fail(badRequest(error.message)),
							}),
						),
					),
			);

			const listPlugins = Effect.fn("PluginIngestionService.listPlugins")(function* () {
				const plugins = yield* runWithDb(repository.list());
				return plugins.map(toListItem);
			});

			const installPlugin = Effect.fn("PluginIngestionService.installPlugin")(function* (
				source: PluginSource,
			) {
				return toListItem(yield* ingestPlugin(source));
			});

			const uninstallPluginUnlocked = Effect.fn("PluginIngestionService.uninstallPluginUnlocked")(
				function* (slug: string) {
					const result = yield* runTransaction(
						Effect.gen(function* () {
							yield* repository.lockIngestion();
							const installed = yield* repository.list();
							const plugin = installed.find(
								(candidate) => candidate.manifest.metadata.slug === slug,
							);
							if (!plugin) {
								return yield* notFound(`Active plugin '${slug}' was not found`);
							}
							if (bootConfiguredPluginSlugs.has(slug)) {
								return yield* conflict(`Boot-configured plugin '${slug}' cannot be uninstalled`);
							}
							if (yield* workflowReferences.hasReferences(slug)) {
								return yield* conflict(
									`Plugin '${slug}' cannot be uninstalled while running or suspended workflows reference it`,
								);
							}
							if (yield* repository.hasIntegrationReferences(slug)) {
								return yield* conflict(
									`Plugin '${slug}' cannot be uninstalled while integrations reference it`,
								);
							}
							const schemaSlugs = plugin.manifest.entitySchemas.map(
								({ slug: entitySchemaSlug }) => entitySchemaSlug,
							);
							if (
								yield* repository.hasEntityReferences({
									pluginSlug: slug,
									entitySchemaSlugs: schemaSlugs,
								})
							) {
								return yield* conflict(
									`Plugin '${slug}' cannot be uninstalled while entities reference its schemas or providers`,
								);
							}
							const remaining = installed.filter(
								(candidate) => candidate.manifest.metadata.slug !== slug,
							);
							const snapshot = yield* Effect.try({
								try: () => loader.previewAll(remaining),
								catch: (error) =>
									conflict(
										`Plugin '${slug}' cannot be uninstalled while active plugin schemas reference its definitions: ${String(error)}`,
									),
							});
							const validateAndCatch = validateSnapshot(snapshot).pipe(
								Effect.as(null),
								Effect.catchTag("PluginValidationError", (error) => Effect.succeed(error)),
							);
							const dangling = yield* validateAndCatch;
							if (dangling) {
								return yield* conflict(
									`Plugin '${slug}' cannot be uninstalled while active plugin bindings reference its definitions: ${validationMessage(dangling)}`,
								);
							}
							yield* repository.deactivate(slug);
							return { plugin, snapshot };
						}),
					);
					loader.replace(result.snapshot);
					yield* publishInvalidation(stableStringify({ action: "uninstall", slug }));
					return toListItem(result.plugin);
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
) {}

export const handlePluginRegistryInvalidation = (
	incoming: string,
	ingestion: Pick<PluginIngestionService, "rebuild">,
) =>
	incoming === redisKeys.pluginRegistryChannel
		? ingestion.rebuild().pipe(Effect.asVoid)
		: Effect.void;

export const runPluginRegistryReconciliation = (
	tick: Effect.Effect<void>,
	ingestion: Pick<PluginIngestionService, "reconcile">,
) =>
	tick.pipe(
		Effect.zipRight(
			ingestion
				.reconcile()
				.pipe(
					Effect.catchAllCause((cause) =>
						Cause.isInterrupted(cause)
							? Effect.failCause(cause)
							: Effect.logError("plugin registry reconciliation failed", cause),
					),
				),
		),
		Effect.forever,
	);

export class PluginInvalidationSubscriber extends Effect.Service<PluginInvalidationSubscriber>()(
	"PluginInvalidationSubscriber",
	{
		scoped: Effect.gen(function* () {
			const redis = yield* RedisService;
			const runFork = yield* FiberSet.makeRuntime();
			const subscriber = redis.client.duplicate();
			const ingestion = yield* PluginIngestionService;
			const rebuildLock = yield* Effect.makeSemaphore(1);
			const channel = redisKeys.pluginRegistryChannel;
			const onMessage = (incoming: string) => {
				runFork(
					rebuildLock
						.withPermits(1)(handlePluginRegistryInvalidation(incoming, ingestion))
						.pipe(Effect.catchAllCause((cause) => Effect.logError(cause))),
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
					Effect.zipRight(Effect.tryPromise(() => subscriber.quit()).pipe(Effect.ignore)),
				),
			);
			return { subscribed: true as const };
		}),
	},
) {}
