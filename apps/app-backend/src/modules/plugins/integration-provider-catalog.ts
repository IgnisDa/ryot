import type { PluginIntegrationProvider } from "@ryot/contract/modules/plugins/manifest";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { Context, Effect, Layer } from "effect";

import { PluginLoader, PluginLoaderLive, type PluginRegistrySnapshot } from "./loader";
import { findActiveScriptInPluginSnapshot } from "./runtime-resolver";

export type RegisteredIntegrationProvider = {
	readonly slug: string;
	readonly name: string;
	readonly pluginSlug: string;
	readonly description: string;
	readonly settingsSchema: AppSchema;
	readonly scriptSlug: string | null;
	readonly lot: PluginIntegrationProvider["lot"];
};

const fromSnapshot = (
	snapshot: PluginRegistrySnapshot,
): ReadonlyArray<RegisteredIntegrationProvider> =>
	Object.entries(snapshot.plugins)
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
				left.pluginSlug.localeCompare(right.pluginSlug) || left.slug.localeCompare(right.slug),
		);

export class IntegrationProviderCatalog extends Context.Service<IntegrationProviderCatalog>()(
	"IntegrationProviderCatalog",
	{
		make: Effect.gen(function* () {
			const loader = yield* PluginLoader;

			const list = () => fromSnapshot(loader.getSnapshot());

			const find = (providerSlug: string) =>
				list().find(({ slug }) => slug === providerSlug) ?? null;
			const findOwned = (providerSlug: string, pluginSlug: string) =>
				fromSnapshot(loader.getSnapshot()).find(
					(provider) => provider.slug === providerSlug && provider.pluginSlug === pluginSlug,
				) ?? null;

			const resolveOwned = (providerSlug: string, pluginSlug: string) => {
				const snapshot = loader.getSnapshot();
				const provider = fromSnapshot(snapshot).find(
					(candidate) => candidate.slug === providerSlug && candidate.pluginSlug === pluginSlug,
				);
				if (!provider) {
					return null;
				}
				const script = provider.scriptSlug
					? findActiveScriptInPluginSnapshot(snapshot, {
							scriptSlug: provider.scriptSlug,
							pluginSlug: provider.pluginSlug,
						})
					: Effect.succeed(null);
				return { provider, script };
			};

			return { find, list, findOwned, resolveOwned };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export const IntegrationProviderCatalogLive = IntegrationProviderCatalog.layer.pipe(
	Layer.provideMerge(PluginLoaderLive),
);
