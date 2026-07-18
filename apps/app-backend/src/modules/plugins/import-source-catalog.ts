import type { PluginConfigSchema, PluginImportSource } from "@ryot/plugin-kit/manifest";
import { Effect, Layer } from "effect";

import { PluginLoader, PluginLoaderLive, type PluginRegistrySnapshot } from "./loader";
import { findActiveWorkflowScriptInSnapshot } from "./runtime-resolver";

export type RegisteredImportSource = PluginImportSource & {
	readonly pluginSlug: string;
	readonly configSchema: PluginConfigSchema;
};

const fromSnapshot = (snapshot: PluginRegistrySnapshot): ReadonlyArray<RegisteredImportSource> =>
	Object.entries(snapshot.plugins)
		.flatMap(([pluginSlug, plugin]) =>
			plugin.manifest.importSources.map((source) => ({
				...source,
				pluginSlug,
				configSchema: plugin.manifest.configSchema,
			})),
		)
		.sort(
			(left, right) =>
				left.pluginSlug.localeCompare(right.pluginSlug) || left.slug.localeCompare(right.slug),
		);

export class ImportSourceCatalog extends Effect.Service<ImportSourceCatalog>()(
	"ImportSourceCatalog",
	{
		effect: Effect.gen(function* () {
			const loader = yield* PluginLoader;

			const list = () => fromSnapshot(loader.getSnapshot());

			const find = (sourceSlug: string) => list().find(({ slug }) => slug === sourceSlug) ?? null;

			const resolve = (sourceSlug: string) => {
				const snapshot = loader.getSnapshot();
				const source = fromSnapshot(snapshot).find(({ slug }) => slug === sourceSlug);
				return source
					? {
							source,
							script: findActiveWorkflowScriptInSnapshot(snapshot, {
								pluginSlug: source.pluginSlug,
								workflowSlug: source.workflowSlug,
							}),
						}
					: null;
			};

			return { find, list, resolve };
		}),
	},
) {}

export const ImportSourceCatalogLive = ImportSourceCatalog.Default.pipe(
	Layer.provideMerge(PluginLoaderLive),
);
