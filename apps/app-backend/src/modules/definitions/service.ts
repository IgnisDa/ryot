import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { notFound } from "@ryot/contract/errors";
import type { UpdatePluginStateBody } from "@ryot/contract/modules/definitions/schemas";
import { PluginSlug } from "@ryot/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { PluginLoader } from "#modules/plugins/loader";

import { DefinitionsRepository, type PluginStateRow } from "./repository";

const merge = (
	metadata: ReturnType<
		PluginLoader["Service"]["getSnapshot"]
	>["plugins"][string]["manifest"]["metadata"],
	state?: PluginStateRow | null,
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
			const runWithDb = yield* DbRunner;
			const loader = yield* PluginLoader;
			const repository = yield* DefinitionsRepository;

			const listPlugins = Effect.fn(function* (
				user: Pick<CurrentUserValue, "id">,
				includeDisabled: boolean,
			) {
				const states = yield* runWithDb(repository.listPluginStates(user.id));
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
					return yield* notFound("Plugin not found");
				}
				const current = yield* runWithDb(repository.getPluginState(user.id, pluginSlug));
				const defaultSortOrder = Object.keys(plugins).indexOf(pluginSlug);
				const state = yield* runWithDb(
					repository.upsertPluginState({
						pluginSlug,
						userId: user.id,
						config: payload.config ?? current?.config ?? {},
						isDisabled: payload.isDisabled ?? current?.isDisabled ?? false,
						sortOrder: payload.sortOrder ?? current?.sortOrder ?? defaultSortOrder,
					}),
				);
				return merge(plugin.manifest.metadata, state, defaultSortOrder);
			});

			return { listPlugins, updatePluginState };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
