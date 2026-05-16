import { PluginSlug } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { requirePresent } from "~/support/assertions";

import type { Client } from "./auth";

export const createPluginScope = (slug = `plugin-${crypto.randomUUID()}`) => PluginSlug.make(slug);

export const listInstalledPlugins = (client: Client, options: { includeDisabled?: boolean } = {}) =>
	client.call((c) =>
		c.definitions.listPlugins({ query: { includeDisabled: options.includeDisabled ?? false } }),
	);

export const findBuiltinPlugin = (client: Client) =>
	Effect.gen(function* () {
		const plugins = yield* listInstalledPlugins(client, { includeDisabled: true });
		return requirePresent(plugins[0], "Built-in plugin not found");
	});

export const findBuiltinPluginBySlug = (client: Client, slug: string) =>
	Effect.gen(function* () {
		const plugins = yield* listInstalledPlugins(client, { includeDisabled: true });
		const plugin = plugins.find((entry) => entry.slug === slug);
		return requirePresent(plugin, `Built-in plugin '${slug}' not found`);
	});

export const updatePluginState = (
	client: Client,
	pluginSlug: string,
	payload: { config?: Record<string, unknown>; isDisabled?: boolean; sortOrder?: number },
) =>
	client.call((c) =>
		c.definitions.updatePluginState({
			payload,
			params: { pluginSlug: PluginSlug.make(pluginSlug) },
		}),
	);
