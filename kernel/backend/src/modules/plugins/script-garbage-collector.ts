import { Context, DateTime, Effect, Layer, FileSystem, Path } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { garbageCollectSandboxCompiledModules } from "#lib/infrastructure/sandbox-runtime/compiled-modules";
import { PackageCacheManager } from "#lib/infrastructure/sandbox-runtime/runtime";

import { PluginRepository } from "./repository";

export class ScriptGarbageCollector extends Context.Service<ScriptGarbageCollector>()(
	"ScriptGarbageCollector",
	{
		make: Effect.gen(function* () {
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const database = yield* Database;
			const config = yield* AppConfig;
			const repository = yield* PluginRepository;
			const runtime = yield* PackageCacheManager;
			const collect = Effect.fn("ScriptGarbageCollector.collect")(function* (input?: {
				now: Date;
				limit: number;
			}) {
				const now = input?.now ?? DateTime.toDate(yield* DateTime.now);
				const limit = input?.limit ?? 500;

				const result = yield* mapDatabaseErrors(
					database.transaction((transaction) =>
						Effect.gen(function* () {
							yield* repository.lockIngestion();
							yield* repository.pruneRevisionArtifacts({
								now,
								limit,
								retryWindowDays: config.automations.retryWindowDays,
							});
							const liveHashes = new Set(yield* repository.listPersistedLivenessContentHashes(now));
							const moduleResult = yield* garbageCollectSandboxCompiledModules(
								runtime,
								liveHashes,
								limit,
							).pipe(
								Effect.provideService(FileSystem.FileSystem, fs),
								Effect.provideService(Path.Path, path),
							);
							const removedScripts = yield* repository.deleteUnreferencedScripts(liveHashes, {
								now,
								limit,
							});
							const removedPlugins = yield* repository.deleteInactiveUnreferencedPlugins(limit);
							return {
								removedCount:
									moduleResult.removedCount + removedScripts.length + removedPlugins.length,
								candidateCount:
									moduleResult.candidateCount + removedScripts.length + removedPlugins.length,
							};
						}).pipe(Effect.provideService(Database, transaction)),
					),
				);
				yield* Effect.logInfo("sandbox script garbage collection completed").pipe(
					Effect.annotateLogs(result),
				);
				return result;
			});

			return { collect };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
