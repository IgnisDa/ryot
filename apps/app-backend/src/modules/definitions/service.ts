import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import {
	DefinitionNotFound,
	type UpdatePluginStateBody,
} from "@ryot/contract/modules/definitions/schemas";
import { PluginSlug } from "@ryot/contract/schema/brands";
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
	config: state?.config ?? {},
	isDisabled: state?.isDisabled ?? false,
	slug: PluginSlug.make(metadata.slug),
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

			const updatePluginState = Effect.fn(function* (
				user: Pick<CurrentUserValue, "id">,
				pluginSlug: PluginSlug,
				payload: UpdatePluginStateBody,
			) {
				const plugins = loader.getSnapshot().plugins;
				const plugin = plugins[pluginSlug];
				if (!plugin) {
					return yield* new DefinitionNotFound({
						reason: { code: "plugin-not-found", pluginSlug },
					});
				}
				const current = yield* repository.findByUserAndPlugin(user.id, plugin.id);
				const defaultSortOrder = Object.keys(plugins).indexOf(pluginSlug);
				const state = yield* repository.upsertState({
					userId: user.id,
					pluginId: plugin.id,
					config: payload.config ?? current?.config ?? {},
					isDisabled: payload.isDisabled ?? current?.isDisabled ?? false,
					sortOrder: payload.sortOrder ?? current?.sortOrder ?? defaultSortOrder,
				});
				return merge(plugin.manifest.metadata, state, defaultSortOrder);
			});

			return { listPlugins, updatePluginState };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
