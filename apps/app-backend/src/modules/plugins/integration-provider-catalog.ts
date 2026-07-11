import type { AppSchema } from "@ryot/contract/schema/property-schema";
import type { PluginIntegrationProvider } from "@ryot/plugin-kit/manifest";
import { Effect, Layer } from "effect";

import { PluginLoader, PluginLoaderLive } from "./loader";

export type RegisteredIntegrationProvider = {
	readonly slug: string;
	readonly name: string;
	readonly pluginSlug: string;
	readonly description: string;
	readonly settingsSchema: AppSchema;
	readonly scriptSlug: string | null;
	readonly lot: PluginIntegrationProvider["lot"];
};

export class IntegrationProviderCatalog extends Effect.Service<IntegrationProviderCatalog>()(
	"IntegrationProviderCatalog",
	{
		effect: Effect.gen(function* () {
			const loader = yield* PluginLoader;

			const list = (): ReadonlyArray<RegisteredIntegrationProvider> =>
				Object.entries(loader.getSnapshot().plugins)
					.flatMap(([pluginSlug, plugin]) =>
						plugin.manifest.integrationProviders.map((provider) => ({
							pluginSlug,
							lot: provider.lot,
							slug: provider.slug,
							name: provider.name,
							description: provider.description,
							settingsSchema: provider.settingsSchema,
							scriptSlug: provider.lot === "push" ? null : provider.scriptSlug,
						})),
					)
					.sort(
						(left, right) =>
							left.pluginSlug.localeCompare(right.pluginSlug) ||
							left.slug.localeCompare(right.slug),
					);

			const find = (providerSlug: string) =>
				list().find(({ slug }) => slug === providerSlug) ?? null;

			return { find, list };
		}),
	},
) {}

export const IntegrationProviderCatalogLive = IntegrationProviderCatalog.Default.pipe(
	Layer.provideMerge(PluginLoaderLive),
);
