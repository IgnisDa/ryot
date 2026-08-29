import { Context, Effect, Layer } from "effect";

import { PluginInstallationRepository } from "./installation-repository";
import { PluginRepository } from "./repository";
import { PluginRevisionActivation } from "./revision-activation";
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
			const activation = yield* PluginRevisionActivation;
			const installations = yield* PluginInstallationRepository;

			const persistUserPlugin = Effect.fn("PluginIngestionLock.persistUserPlugin")(function* (
				plugin: NormalizedPlugin,
				identity: UserPluginPersistenceIdentity,
			) {
				yield* repository.lockIngestion();
				yield* validatePluginManifestPolicy(plugin.manifest, {
					scope: "user",
					systemSlugs: new Set(yield* repository.listActiveSystemSlugs()),
				});
				const pluginId = yield* repository.persist(plugin, identity);
				yield* installations.refreshClientConfigsForPlugin(pluginId);
				yield* activation.activated(pluginId);
				return pluginId;
			});

			return { persistUserPlugin };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
