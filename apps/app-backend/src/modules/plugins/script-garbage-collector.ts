import { Context, Effect, Layer, Option, Ref, FileSystem, Path } from "effect";

import { TransactionRunner } from "#lib/infrastructure/db/service";
import { garbageCollectSandboxCompiledModules } from "#lib/infrastructure/sandbox-runtime/compiled-modules";
import { PackageCacheManager } from "#lib/infrastructure/sandbox-runtime/runtime";
import { SandboxWorkflowReferenceRepository } from "#modules/sandbox/workflow-reference-repository";

import { PluginLoader } from "./loader";
import { PluginRepository } from "./repository";

export class ScriptGarbageCollector extends Context.Service<ScriptGarbageCollector>()(
	"ScriptGarbageCollector",
	{
		make: Effect.gen(function* () {
			const path = yield* Path.Path;
			const loader = yield* PluginLoader;
			const fs = yield* FileSystem.FileSystem;
			const repository = yield* PluginRepository;
			const runtime = yield* PackageCacheManager;
			const runTransaction = yield* TransactionRunner;
			const workflowReferences = yield* SandboxWorkflowReferenceRepository;
			const kernelContentHashes = yield* Ref.make<Option.Option<ReadonlySet<string>>>(
				Option.none(),
			);

			const liveContentHashes = Effect.fn("ScriptGarbageCollector.liveContentHashes")(function* (
				kernelHashes: ReadonlySet<string>,
			) {
				const localPlugins = Object.values(loader.getSnapshot().plugins);
				const plugins = yield* repository.list();
				const references = yield* workflowReferences.listReferences();
				const persistedHashes = yield* repository.listPersistedLivenessContentHashes(
					new Set(references.map(({ pluginSlug }) => pluginSlug)),
				);
				return new Set([
					...kernelHashes,
					...persistedHashes,
					...plugins.flatMap(({ scripts }) => scripts.map(({ contentHash }) => contentHash)),
					...localPlugins.flatMap(({ scripts }) => scripts.map(({ contentHash }) => contentHash)),
				]);
			});

			const recordKernelContentHashes = Effect.fn(
				"ScriptGarbageCollector.recordKernelContentHashes",
			)((hashes: ReadonlySet<string>) =>
				Ref.set(kernelContentHashes, Option.some(new Set(hashes))),
			);

			const collect = Effect.fn("ScriptGarbageCollector.collect")(function* () {
				const kernelHashes = yield* Ref.get(kernelContentHashes);
				if (Option.isNone(kernelHashes)) {
					return undefined;
				}

				const result = yield* runTransaction(
					Effect.gen(function* () {
						yield* repository.lockIngestion();
						const liveHashes = yield* liveContentHashes(kernelHashes.value);
						const moduleResult = yield* garbageCollectSandboxCompiledModules(
							runtime,
							liveHashes,
						).pipe(
							Effect.provideService(FileSystem.FileSystem, fs),
							Effect.provideService(Path.Path, path),
						);
						const removedScripts = yield* repository.deleteUnreferencedScripts(liveHashes);
						return {
							candidateCount: moduleResult.candidateCount + removedScripts.length,
							removedCount: moduleResult.removedCount + removedScripts.length,
						};
					}),
				);
				yield* Effect.logInfo("sandbox script garbage collection completed").pipe(
					Effect.annotateLogs(result),
				);
				return result;
			});

			return { collect, recordKernelContentHashes };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
