import { Context, DateTime, Effect, Layer } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { PluginRepository } from "#modules/plugins/repository";

export class ScriptGarbageCollector extends Context.Service<ScriptGarbageCollector>()(
	"ScriptGarbageCollector",
	{
		make: Effect.gen(function* () {
			const database = yield* DatabaseSession;
			const config = yield* AppConfig;
			const repository = yield* PluginRepository;
			const deferred = Effect.logDebug("sandbox script garbage collection deferred").pipe(
				Effect.as({ removedCount: 0 }),
			);
			const collect = Effect.fn("ScriptGarbageCollector.collect")(function* (input?: {
				now: Date;
				limit: number;
				scheduled?: boolean;
			}) {
				const now = input?.now ?? DateTime.toDate(yield* DateTime.now);
				const limit = input?.limit ?? 500;
				if (input?.scheduled && (yield* repository.hasLiveWorkflowReferences())) {
					return yield* deferred;
				}

				const result = yield* database.transaction(
					Effect.gen(function* () {
						if (input?.scheduled) {
							if (!(yield* repository.tryLockIngestion())) {
								return undefined;
							}
							// A pin may commit between the preflight read and the exclusive fence.
							if (yield* repository.hasLiveWorkflowReferences()) {
								return undefined;
							}
						} else {
							yield* repository.lockIngestion();
						}
						yield* repository.pruneRevisionArtifacts({
							now,
							limit,
							retryWindowDays: config.automations.retryWindowDays,
						});
						const liveHashes = new Set(yield* repository.listPersistedLivenessContentHashes(now));
						const removedScripts = yield* repository.deleteUnreferencedScripts(liveHashes, {
							now,
							limit,
						});
						const removedPlugins = yield* repository.deleteInactiveUnreferencedPlugins(limit);
						return { removedCount: removedScripts.length + removedPlugins.length };
					}),
				);
				if (result === undefined) {
					return yield* deferred;
				}
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
