import type {
	PluginConfigSchema,
	PluginImportSource,
} from "@ryot/contract/modules/plugins/manifest";
import type { UserId } from "@ryot/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import type { PluginConfigContext } from "#lib/infrastructure/sandbox-runtime/app-config";

import {
	pluginConfigContextFor,
	PluginRuntimeResolver,
	PluginRuntimeResolverLive,
	type AvailablePlugin,
} from "./runtime-resolver";

export type RegisteredImportSource = PluginImportSource & {
	readonly pluginId: string;
	readonly pluginSlug: string;
	readonly installationId: string;
	readonly pluginScope: "system" | "user";
	readonly configSchema: PluginConfigSchema;
	readonly configContext: PluginConfigContext;
};

const fromAvailablePlugins = (
	plugins: ReadonlyArray<AvailablePlugin>,
): ReadonlyArray<RegisteredImportSource> =>
	plugins
		.flatMap((plugin) =>
			plugin.manifest.importSources.map((source) => ({
				...source,
				pluginId: plugin.id,
				pluginSlug: plugin.slug,
				pluginScope: plugin.scope,
				installationId: plugin.installationId,
				configContext: pluginConfigContextFor(plugin),
				configSchema: plugin.manifest.configSchema,
			})),
		)
		.sort(
			(left, right) =>
				left.pluginSlug.localeCompare(right.pluginSlug) || left.slug.localeCompare(right.slug),
		);

export class ImportSourceCatalog extends Context.Service<ImportSourceCatalog>()(
	"ImportSourceCatalog",
	{
		make: Effect.gen(function* () {
			const runtime = yield* PluginRuntimeResolver;

			const findWorkflowScript = (
				plugins: ReadonlyArray<AvailablePlugin>,
				source: RegisteredImportSource,
			) => {
				const plugin = plugins.find(({ id }) => id === source.pluginId);
				return plugin
					? runtime.findWorkflowScriptInAvailablePlugin(plugin, source.workflowSlug)
					: Effect.succeed(null);
			};

			const listForUser = Effect.fn("ImportSourceCatalog.listForUser")(function* (userId: UserId) {
				const plugins = yield* runtime.listPluginsAvailableToUser(userId);
				return yield* Effect.forEach(fromAvailablePlugins(plugins), (source) =>
					findWorkflowScript(plugins, source).pipe(
						Effect.map((script) => ({ source, hasActiveWorkflow: script !== null })),
					),
				);
			});

			const resolveForUser = Effect.fn("ImportSourceCatalog.resolveForUser")(function* (
				userId: UserId,
				sourceSlug: string,
			) {
				const plugins = yield* runtime.listPluginsAvailableToUser(userId);
				const source = fromAvailablePlugins(plugins).find(({ slug }) => slug === sourceSlug);
				return source ? { source, script: yield* findWorkflowScript(plugins, source) } : null;
			});

			return { listForUser, resolveForUser };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export const ImportSourceCatalogLive = ImportSourceCatalog.layer.pipe(
	Layer.provide(PluginRuntimeResolverLive),
);
