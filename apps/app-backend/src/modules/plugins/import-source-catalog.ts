import type { PluginConfigSchema, PluginImportSource } from "@ryot/plugin-kit/manifest";
import { Effect, Layer } from "effect";

import { PluginLoader, PluginLoaderLive } from "./loader";

export type RegisteredImportSource = PluginImportSource & {
	readonly pluginSlug: string;
	readonly configSchema: PluginConfigSchema;
};

export class ImportSourceCatalog extends Effect.Service<ImportSourceCatalog>()(
	"ImportSourceCatalog",
	{
		effect: Effect.gen(function* () {
			const loader = yield* PluginLoader;

			const list = (): ReadonlyArray<RegisteredImportSource> =>
				Object.entries(loader.getSnapshot().plugins)
					.flatMap(([pluginSlug, plugin]) =>
						plugin.manifest.importSources.map((source) => ({
							...source,
							pluginSlug,
							configSchema: plugin.manifest.configSchema,
						})),
					)
					.sort(
						(left, right) =>
							left.pluginSlug.localeCompare(right.pluginSlug) ||
							left.slug.localeCompare(right.slug),
					);

			const find = (sourceSlug: string) => list().find(({ slug }) => slug === sourceSlug) ?? null;

			return { find, list };
		}),
	},
) {}

export const ImportSourceCatalogLive = ImportSourceCatalog.Default.pipe(
	Layer.provideMerge(PluginLoaderLive),
);
