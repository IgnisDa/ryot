import { Context, Effect, Layer } from "effect";

import { PluginRepository } from "./repository";
import type { NormalizedPlugin, PluginPersistenceIdentity } from "./types";
import { validatePluginManifestPolicy } from "./validation";

type UserPluginPersistenceIdentity = PluginPersistenceIdentity & {
	readonly scope: "user";
	readonly ownerId: string;
};

export class PluginIngestionLock extends Context.Service<PluginIngestionLock>()(
	"PluginIngestionLock",
	{
		make: Effect.gen(function* () {
			const repository = yield* PluginRepository;

			const persistUserPlugin = Effect.fn("PluginIngestionLock.persistUserPlugin")(function* (
				plugin: NormalizedPlugin,
				identity: UserPluginPersistenceIdentity,
			) {
				yield* repository.lockIngestion();
				const systemManifests = yield* repository.listActiveManifests();
				yield* validatePluginManifestPolicy(plugin.manifest, {
					scope: "user",
					systemSlugs: new Set(systemManifests.map(({ metadata }) => metadata.slug)),
				});
				return yield* repository.persist(plugin, identity);
			});

			return { persistUserPlugin };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
