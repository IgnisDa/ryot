import type { AppSchema } from "@ryot/contract/schema/property-schema";
import type { PluginIntegrationProvider } from "@ryot/plugin-kit/manifest";
import { Effect, Layer } from "effect";

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

export class IntegrationProviderCatalog extends Effect.Service<IntegrationProviderCatalog>()(
	"IntegrationProviderCatalog",
	{
		effect: Effect.gen(function* () {
			const loader = yield* PluginLoader;

			const list = () => fromSnapshot(loader.getSnapshot());

			const find = (providerSlug: string) =>
				list().find(({ slug }) => slug === providerSlug) ?? null;

			const resolve = (providerSlug: string) => {
				const snapshot = loader.getSnapshot();
				const provider = fromSnapshot(snapshot).find(({ slug }) => slug === providerSlug);
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

			return { find, list, resolve };
		}),
	},
) {}

export const IntegrationProviderCatalogLive = IntegrationProviderCatalog.Default.pipe(
	Layer.provideMerge(PluginLoaderLive),
);
