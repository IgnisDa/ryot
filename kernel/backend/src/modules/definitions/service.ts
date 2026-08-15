import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { PluginSlug } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import {
	PluginInstallationRepository,
	type PluginInstallationRow,
} from "#modules/plugins/installation-repository";
import { PluginLoader } from "#modules/plugins/loader";

const merge = (
	metadata: ReturnType<
		PluginLoader["Service"]["getSnapshot"]
	>["plugins"][string]["manifest"]["metadata"],
	state?: PluginInstallationRow | null,
	defaultSortOrder = 0,
) => ({
	...metadata,
	slug: PluginSlug.make(metadata.slug),
	isDisabled: state?.isDisabled ?? false,
	sortOrder: state?.sortOrder ?? defaultSortOrder,
});

export class DefinitionsService extends Context.Service<DefinitionsService>()(
	"DefinitionsService",
	{
		make: Effect.gen(function* () {
			const loader = yield* PluginLoader;
			const repository = yield* PluginInstallationRepository;

			const listPlugins = Effect.fn(function* (
				user: Pick<CurrentUserValue, "id">,
				includeDisabled: boolean,
			) {
				const states = yield* repository.listForUser(user.id);
				const bySlug = new Map(states.map((state) => [state.pluginSlug, state]));
				return Object.values(loader.getSnapshot().plugins)
					.map(({ manifest }, index) =>
						merge(manifest.metadata, bySlug.get(manifest.metadata.slug), index),
					)
					.filter((plugin) => includeDisabled || !plugin.isDisabled)
					.sort((left, right) => left.sortOrder - right.sortOrder);
			});

			return { listPlugins };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
