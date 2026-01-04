import { compilePluginSandboxSourceEntries } from "@ryot/sandbox-compiler/plugins";
import { stableStringify } from "@ryot/ts-utils/json";
import { Data, Effect, Runtime } from "effect";

import { DbRunner, TransactionRunner } from "#lib/infrastructure/db/service";
import { redisKeys, RedisService } from "#lib/infrastructure/redis";

import { PluginLoader } from "./loader";
import { PluginRepository } from "./repository";
import { validateAdditiveSchemaEvolution } from "./schema-evolution";
import type { NormalizedPlugin, PluginSource } from "./types";
import {
	decodePluginManifest,
	PluginValidationError,
	validatePluginManifestReferences,
} from "./validation";

export class PluginSourceError extends Data.TaggedError("PluginSourceError")<{
	readonly message: string;
}> {}

const digest = (value: string) => new Bun.CryptoHasher("sha256").update(value).digest("hex");

const loadSourceFiles = (packageRoot: string) =>
	Effect.gen(function* () {
		const paths = yield* Effect.try({
			try: () =>
				Array.from(new Bun.Glob("**/*.ts").scanSync({ cwd: packageRoot, onlyFiles: true })).filter(
					(path) => !path.endsWith(".test.ts"),
				),
			catch: (error) => new PluginSourceError({ message: String(error) }),
		});
		const entries = yield* Effect.forEach(paths, (path) =>
			Effect.tryPromise({
				try: () => Bun.file(`${packageRoot}/${path}`).text(),
				catch: (error) => new PluginSourceError({ message: String(error) }),
			}).pipe(Effect.map((contents) => [path, contents] as const)),
		);
		return Object.fromEntries(entries);
	});

const declaredScriptMetadata = <Script extends { readonly entry: string }>(script: Script) => {
	const { entry: _entry, ...metadata } = script;
	return metadata;
};

export class PluginIngestionService extends Effect.Service<PluginIngestionService>()(
	"PluginIngestionService",
	{
		effect: Effect.gen(function* () {
			const redis = yield* RedisService;
			const runWithDb = yield* DbRunner;
			const loader = yield* PluginLoader;
			const repository = yield* PluginRepository;
			const runTransaction = yield* TransactionRunner;

			const rebuild = Effect.fn("PluginIngestionService.rebuild")(function* () {
				const plugins = yield* runWithDb(repository.list());
				loader.rebuild(plugins);
				return loader.getSnapshot();
			});

			const ingestPlugin = Effect.fn("PluginIngestionService.ingestPlugin")(function* (
				source: PluginSource,
			) {
				const manifest = yield* decodePluginManifest(source.manifest);
				const files = yield* loadSourceFiles(source.packageRoot);
				const sourceHash = digest(stableStringify({ files, manifest }));
				const candidate = { manifest, sourceHash, scripts: [] } satisfies NormalizedPlugin;
				yield* Effect.try({
					try: () => loader.preview(candidate),
					catch: (error) => new PluginValidationError({ issues: [String(error)] }),
				});
				const isolatedPreview = loader.previewAll([candidate]);
				yield* validatePluginManifestReferences(manifest, isolatedPreview.definitions);

				const cached = yield* runWithDb(
					repository.findBySourceHash({ slug: manifest.metadata.slug, sourceHash }),
				);
				if (cached) {
					loader.load(cached);
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
				yield* runTransaction(
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
						yield* Effect.try({
							try: () => loader.previewAll(nextInstalled),
							catch: (error) => new PluginValidationError({ issues: [String(error)] }),
						});
						yield* repository.persist(normalized);
					}),
				);
				loader.load(normalized);
				yield* redis.publish(
					redisKeys.pluginRegistryChannel,
					stableStringify({ slug: manifest.metadata.slug, sourceHash }),
				);
				return normalized;
			});

			return { rebuild, ingestPlugin };
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
