import type { ContractPathParams, ContractPayload } from "@ryot-app/contract/client";
import type { PluginPackageReference } from "@ryot-app/contract/modules/plugins/references";
import { type PluginId, PluginSlug } from "@ryot-app/contract/schema/brands";
import { pluginInstallationsRecipe } from "@ryot-app/ryotql-recipes/plugin-installations";
import { Effect } from "effect";

import { requirePresent } from "~/support/assertions";

import type { Client } from "./auth";
import { collectRyotQLRecipeItems } from "./ryotql";

export const createPluginScope = (slug = `plugin-${crypto.randomUUID()}`) => PluginSlug.make(slug);

export const listInstalledPlugins = (client: Client, options: { includeHidden?: boolean } = {}) =>
	collectRyotQLRecipeItems(client, (after) =>
		pluginInstallationsRecipe({ after, limit: 100 }),
	).pipe(
		Effect.map((plugins) =>
			options.includeHidden ? plugins : plugins.filter((plugin) => !plugin.isHidden),
		),
	);

export const findPluginInstallationById = (
	client: Client,
	installationId: ContractPathParams<"plugins", "update">["installationId"],
) =>
	Effect.gen(function* () {
		const installations = yield* listInstalledPlugins(client, { includeHidden: true });
		return requirePresent(
			installations.find((installation) => installation.installationId === installationId),
			`Plugin installation '${installationId}' not found`,
		);
	});

export const findPluginInstallationByPluginId = (client: Client, pluginId: PluginId) =>
	Effect.gen(function* () {
		const installations = yield* listInstalledPlugins(client, { includeHidden: true });
		return requirePresent(
			installations.find((installation) => installation.pluginId === pluginId),
			`Plugin '${pluginId}' installation not found`,
		);
	});

export const findPluginInstallationByPackage = (
	client: Client,
	reference: PluginPackageReference,
) =>
	Effect.gen(function* () {
		const installations = yield* listInstalledPlugins(client, { includeHidden: true });
		return requirePresent(
			installations.find(
				(installation) =>
					installation.packageId === reference.packageId && installation.scope === reference.scope,
			),
			"Plugin installation not found",
		);
	});

export const findBuiltinPluginByPackage = (
	client: Client,
	reference: PluginPackageReference & { readonly scope: "system" },
) => findPluginInstallationByPackage(client, reference);

export const updatePluginState = (
	client: Client,
	installationId: ContractPathParams<"plugins", "updatePluginState">["installationId"],
	payload: ContractPayload<"plugins", "updatePluginState">,
) => client.call((c) => c.plugins.updatePluginState({ payload, params: { installationId } }));

export const setPluginHomeView = (
	client: Client,
	installationId: ContractPathParams<"plugins", "setHomeView">["installationId"],
	savedView: ContractPayload<"plugins", "setHomeView">["savedView"],
) =>
	client.call((contract) =>
		contract.plugins.setHomeView({ payload: { savedView }, params: { installationId } }),
	);
