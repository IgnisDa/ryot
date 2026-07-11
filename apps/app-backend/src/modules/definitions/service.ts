import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { notFound } from "@ryot/contract/errors";
import type { UpdateWorkspaceStateBody } from "@ryot/contract/modules/definitions/schemas";
import { PluginSlug } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { PluginLoader } from "#modules/plugins/loader";

import { DefinitionsRepository, type PluginStateRow } from "./repository";

const merge = (
	metadata: ReturnType<PluginLoader["getSnapshot"]>["plugins"][string]["manifest"]["metadata"],
	state?: PluginStateRow | null,
	defaultSortOrder = 0,
) => ({
	...metadata,
	slug: PluginSlug.make(metadata.slug),
	config: state?.config ?? {},
	isDisabled: state?.isDisabled ?? false,
	sortOrder: state?.sortOrder ?? defaultSortOrder,
});

export class DefinitionsService extends Effect.Service<DefinitionsService>()("DefinitionsService", {
	effect: Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const loader = yield* PluginLoader;
		const repository = yield* DefinitionsRepository;
		const listWorkspaces = Effect.fn(function* (
			user: Pick<CurrentUserValue, "id">,
			includeDisabled: boolean,
		) {
			const states = yield* runWithDb(repository.listPluginStates(user.id));
			const bySlug = new Map(states.map((state) => [state.pluginSlug, state]));
			return Object.values(loader.getSnapshot().plugins)
				.map(({ manifest }, index) =>
					merge(manifest.metadata, bySlug.get(manifest.metadata.slug), index),
				)
				.filter((workspace) => includeDisabled || !workspace.isDisabled)
				.sort((left, right) => left.sortOrder - right.sortOrder);
		});
		const updateWorkspaceState = Effect.fn(function* (
			user: Pick<CurrentUserValue, "id">,
			pluginSlug: PluginSlug,
			payload: UpdateWorkspaceStateBody,
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
					userId: user.id,
					pluginSlug,
					config: payload.config ?? current?.config ?? {},
					isDisabled: payload.isDisabled ?? current?.isDisabled ?? false,
					sortOrder: payload.sortOrder ?? current?.sortOrder ?? defaultSortOrder,
				}),
			);
			return merge(plugin.manifest.metadata, state, defaultSortOrder);
		});
		return { listWorkspaces, updateWorkspaceState };
	}),
}) {}
