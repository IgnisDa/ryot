import { badRequest, conflict, notFound } from "@ryot/contract/errors";
import type { PluginListItem } from "@ryot/contract/modules/plugins/schemas";
import { compilePluginSandboxSourceEntries } from "@ryot/sandbox-compiler/plugins";
import { stableStringify } from "@ryot/ts-utils/json";
import { Effect, Runtime } from "effect";

import { DbRunner, TransactionRunner } from "#lib/infrastructure/db/service";
import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import { kernelDefinitionSource, kernelScripts } from "#modules/definition-registry/kernel-source";

import { bootConfiguredPluginSlugs } from "./boot-sources";
import { PluginLoader } from "./loader";
import { PluginRepository } from "./repository";
import type { SchemaEvolutionError } from "./schema-evolution";
import { validateAdditiveSchemaEvolution } from "./schema-evolution";
import type { NormalizedPlugin, PluginSource } from "./types";
import {
	decodePluginManifest,
	PluginValidationError,
	validatePluginManifestReferences,
	validatePluginSourcePaths,
	validateSignalSchemaFormatterReferences,
} from "./validation";

const digest = (value: string) => new Bun.CryptoHasher("sha256").update(value).digest("hex");

const declaredScriptMetadata = <Script extends { readonly entry: string }>(script: Script) => {
	const { entry: _entry, ...metadata } = script;
	return metadata;
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
			const runTransaction = yield* TransactionRunner;
			const mutationLock = yield* Effect.makeSemaphore(1);
			const kernelSignalSlugs = new Set(
				kernelDefinitionSource().signalSchemas.map(({ slug }) => slug),
			);
			const validateSnapshot = Effect.fn("PluginIngestionService.validateSnapshot")(function* (
				snapshot: ReturnType<PluginLoader["getSnapshot"]>,
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
					({ manifest }) => validatePluginManifestReferences(manifest, snapshot.definitions),
					{ discard: true },
				);
			});

			const rebuildUnlocked = Effect.fn("PluginIngestionService.rebuildUnlocked")(function* () {
				const plugins = yield* runWithDb(repository.list());
				const snapshot = yield* Effect.try({
					try: () => loader.previewAll(plugins),
					catch: (error) => new PluginValidationError({ issues: [String(error)] }),
				});
				yield* validateSnapshot(snapshot);
				loader.replace(snapshot);
				return snapshot;
			});
			const rebuild = Effect.fn("PluginIngestionService.rebuild")(() =>
				mutationLock.withPermits(1)(Effect.uninterruptible(rebuildUnlocked())),
			);

			const ingestPluginUnlocked = Effect.fn("PluginIngestionService.ingestPluginUnlocked")(
				function* (source: PluginSource) {
					const manifest = yield* decodePluginManifest(source.manifest);
					const files = source.files;
					yield* validatePluginSourcePaths(files, manifest.scripts);
					const sourceHash = digest(stableStringify({ files, manifest }));
					const candidate = { manifest, sourceHash, scripts: [] } satisfies NormalizedPlugin;
					const prospectiveSnapshot = yield* Effect.try({
						try: () => loader.preview(candidate),
						catch: (error) => new PluginValidationError({ issues: [String(error)] }),
					});
					yield* validateSnapshot(prospectiveSnapshot);

					const cached = yield* runWithDb(
						repository.findBySourceHash({ slug: manifest.metadata.slug, sourceHash }),
					);
					if (cached) {
						const snapshot = yield* Effect.try({
							try: () => loader.preview(cached),
							catch: (error) => new PluginValidationError({ issues: [String(error)] }),
						});
						loader.replace(snapshot);
						return cached;
					}

					const compiled = yield* compilePluginSandboxSourceEntries(files, manifest.scripts);
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
						if (stableStringify(metadata) !== stableStringify(output.compiled.manifest)) {
							return Effect.fail(
								new PluginValidationError({
									issues: [`Declared script metadata does not match ${script.entry}`],
								}),
							);
						}
						return Effect.succeed({
							metadata,
							slug: script.slug,
							name: script.name,
							entry: script.entry,
							source: output.source,
							compiledFormat: output.compiled.format,
							compiledCode: output.compiled.javascript,
							contentHash: digest(output.compiled.javascript),
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
					yield* redis.publish(
						redisKeys.pluginRegistryChannel,
						stableStringify({ slug: manifest.metadata.slug, sourceHash }),
					);
					return normalized;
				},
			);
			const ingestPlugin = Effect.fn("PluginIngestionService.ingestPlugin")(
				(source: PluginSource) =>
					mutationLock.withPermits(1)(
						ingestPluginUnlocked(source).pipe(
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
							const schemaSlugs = plugin.manifest.entitySchemas.map(
								({ slug: entitySchemaSlug }) => entitySchemaSlug,
							);
							if (yield* repository.hasEntityReferences(schemaSlugs)) {
								return yield* conflict(
									`Plugin '${slug}' cannot be uninstalled while entities reference its schemas`,
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
							const dangling = yield* validateSnapshot(snapshot).pipe(
								Effect.as(null),
								Effect.catchTag("PluginValidationError", (error) => Effect.succeed(error)),
							);
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
					yield* redis.publish(
						redisKeys.pluginRegistryChannel,
						stableStringify({ action: "uninstall", slug }),
					);
					return toListItem(result.plugin);
				},
			);
			const uninstallPlugin = Effect.fn("PluginIngestionService.uninstallPlugin")((slug: string) =>
				mutationLock.withPermits(1)(Effect.uninterruptible(uninstallPluginUnlocked(slug))),
			);

			return { rebuild, listPlugins, ingestPlugin, installPlugin, uninstallPlugin };
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

export class PluginInvalidationSubscriber extends Effect.Service<PluginInvalidationSubscriber>()(
	"PluginInvalidationSubscriber",
	{
		scoped: Effect.gen(function* () {
			const redis = yield* RedisService;
			const runtime = yield* Effect.runtime();
			const subscriber = redis.client.duplicate();
			const ingestion = yield* PluginIngestionService;
			const rebuildLock = yield* Effect.makeSemaphore(1);
			const channel = redisKeys.pluginRegistryChannel;
			const onMessage = (incoming: string) => {
				Runtime.runFork(runtime)(
					rebuildLock
						.withPermits(1)(handlePluginRegistryInvalidation(incoming, ingestion))
						.pipe(Effect.catchAllCause((cause) => Effect.logError(cause))),
				);
			};
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
