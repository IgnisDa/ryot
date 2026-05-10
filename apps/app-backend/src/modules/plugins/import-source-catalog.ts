import type {
	PluginConfigSchema,
	PluginImportSource,
} from "@ryot/contract/modules/plugins/manifest";
import { Context, Effect, Layer } from "effect";

import { PluginLoader, type PluginRegistrySnapshot } from "./loader";
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

const findWorkflowInSnapshot = (
	snapshot: PluginRegistrySnapshot,
	pluginSlug: string,
	workflowSlug: string,
) =>
	findActiveWorkflowScriptInSnapshot(snapshot, {
		pluginSlug,
		workflowSlug,
	}).pipe(Effect.map((script) => (script ? { id: script.id } : null)));

export class ImportSourceCatalog extends Context.Service<ImportSourceCatalog>()(
	"ImportSourceCatalog",
	{
		make: Effect.gen(function* () {
			const loader = yield* PluginLoader;

			const listWithWorkflowStatus = Effect.suspend(() => {
				const snapshot = loader.getSnapshot();
				return Effect.forEach(fromSnapshot(snapshot), (source) =>
					findWorkflowInSnapshot(snapshot, source.pluginSlug, source.workflowSlug).pipe(
						Effect.map((script) => ({
							source,
							hasActiveWorkflow: script !== null,
						})),
					),
				);
			});

			const resolve = (sourceSlug: string) => {
				const snapshot = loader.getSnapshot();
				const source = fromSnapshot(snapshot).find(({ slug }) => slug === sourceSlug);
				return source
					? {
							source,
							script: findWorkflowInSnapshot(snapshot, source.pluginSlug, source.workflowSlug),
						}
					: null;
			};

			return { resolve, listWithWorkflowStatus };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
