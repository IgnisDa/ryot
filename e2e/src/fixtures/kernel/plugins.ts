import type { ContractPathParams, ContractPayload } from "@ryot-app/contract/client";
import { PluginSlug } from "@ryot-app/contract/schema/brands";
import { pluginInstallationsRecipe } from "@ryot-app/ryotql-recipes/plugin-installations";
import { Effect } from "effect";

import { requirePresent } from "~/support/assertions";

import type { Client } from "./auth";
import { collectRyotQLRecipeItems } from "./ryotql";

export const createPluginScope = (slug = `plugin-${crypto.randomUUID()}`) => PluginSlug.make(slug);

export const listInstalledPlugins = (client: Client, options: { includeDisabled?: boolean } = {}) =>
	collectRyotQLRecipeItems(client, (after) =>
		pluginInstallationsRecipe({ after, limit: 100 }),
	).pipe(
		Effect.map((plugins) =>
			options.includeDisabled ? plugins : plugins.filter((plugin) => !plugin.isDisabled),
		),
	);

export const findBuiltinPluginBySlug = (client: Client, slug: string) =>
	Effect.gen(function* () {
		const plugins = yield* listInstalledPlugins(client, { includeDisabled: true });
		const plugin = plugins.find((entry) => entry.slug === slug);
		return requirePresent(plugin, `Built-in plugin '${slug}' not found`);
	});

export const findPluginInstallationBySlug = (client: Client, slug: string) =>
	Effect.gen(function* () {
		const installations = yield* listInstalledPlugins(client, { includeDisabled: true });
		return requirePresent(
			installations.find((installation) => installation.slug === slug),
			`Plugin installation '${slug}' not found`,
		);
	});

export const updatePluginState = (
	client: Client,
	pluginSlug: string,
	payload: ContractPayload<"plugins", "updatePluginState">,
) =>
	client.call((c) =>
		c.plugins.updatePluginState({ payload, params: { pluginSlug: PluginSlug.make(pluginSlug) } }),
	);

export const setPluginHomeView = (
	client: Client,
	pluginSlug: ContractPathParams<"plugins", "setHomeView">["pluginSlug"],
	savedViewId: ContractPayload<"plugins", "setHomeView">["savedViewId"],
) =>
	client.call((contract) =>
		contract.plugins.setHomeView({ params: { pluginSlug }, payload: { savedViewId } }),
	);
