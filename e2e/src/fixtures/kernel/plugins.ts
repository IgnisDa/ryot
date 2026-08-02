import type { ContractPathParams, ContractPayload } from "@ryot-app/contract/client";
import { PluginSlug } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import { requirePresent } from "~/support/assertions";

import type { Client } from "./auth";

export const createPluginScope = (slug = `plugin-${crypto.randomUUID()}`) => PluginSlug.make(slug);

export const listInstalledPlugins = (client: Client, options: { includeDisabled?: boolean } = {}) =>
	client.call((c) =>
		c.definitions.listPlugins({ query: { includeDisabled: options.includeDisabled ?? false } }),
	);

export const findBuiltinPluginBySlug = (client: Client, slug: string) =>
	Effect.gen(function* () {
		const plugins = yield* listInstalledPlugins(client, { includeDisabled: true });
		const plugin = plugins.find((entry) => entry.slug === slug);
		return requirePresent(plugin, `Built-in plugin '${slug}' not found`);
	});

export const findPluginInstallationBySlug = (client: Client, slug: string) =>
	Effect.gen(function* () {
		const installations = yield* client.call((contract) => contract.plugins.list());
		return requirePresent(
			installations.find((installation) => installation.slug === slug),
			`Plugin installation '${slug}' not found`,
		);
	});

export const updatePluginState = (
	client: Client,
	pluginSlug: string,
	payload: ContractPayload<"definitions", "updatePluginState">,
) =>
	client.call((c) =>
		c.definitions.updatePluginState({
			payload,
			params: { pluginSlug: PluginSlug.make(pluginSlug) },
		}),
	);

export const setPluginHomeView = (
	client: Client,
	pluginSlug: ContractPathParams<"plugins", "setHomeView">["pluginSlug"],
	savedViewId: ContractPayload<"plugins", "setHomeView">["savedViewId"],
) =>
	client.call((contract) =>
		contract.plugins.setHomeView({ params: { pluginSlug }, payload: { savedViewId } }),
	);
