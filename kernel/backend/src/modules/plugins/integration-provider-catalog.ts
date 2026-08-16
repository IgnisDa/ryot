import type { PluginIntegrationProvider } from "@ryot-app/contract/modules/plugins/manifest";
import type { UserId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Context, Effect, Layer } from "effect";

import {
	pluginConfigContextFor,
	PluginRuntimeResolver,
	PluginRuntimeResolverLive,
	type AvailablePlugin,
} from "./runtime-resolver";

export type RegisteredIntegrationProvider = {
	readonly slug: string;
	readonly name: string;
	readonly pluginId: string;
	readonly pluginSlug: string;
	readonly description: string;
	readonly installationId: string;
	readonly requiresProKey?: boolean;
	readonly settingsSchema: AppSchema;
	readonly scriptSlug: string | null;
	readonly pluginScope: "system" | "user";
	readonly configContext: ReturnType<typeof pluginConfigContextFor>;
	readonly lot: PluginIntegrationProvider["lot"];
};

const fromAvailablePlugins = (
	plugins: ReadonlyArray<AvailablePlugin>,
): ReadonlyArray<RegisteredIntegrationProvider> =>
	plugins
		.flatMap((plugin) =>
			plugin.manifest.integrationProviders.map((provider) => ({
				lot: provider.lot,
				slug: provider.slug,
				name: provider.name,
				pluginId: plugin.id,
				pluginSlug: plugin.slug,
				pluginScope: plugin.scope,
				description: provider.description,
				installationId: plugin.installationId,
				settingsSchema: provider.settingsSchema,
				configContext: pluginConfigContextFor(plugin),
				requiresProKey: provider.requiresProKey ?? false,
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
			const runtime = yield* PluginRuntimeResolver;
			const listResolvedForUser = Effect.fn("IntegrationProviderCatalog.listResolvedForUser")(
				function* (userId: UserId) {
					const plugins = yield* runtime.listPluginsAvailableToUser(userId);
					return yield* Effect.forEach(fromAvailablePlugins(plugins), (provider) =>
						Effect.gen(function* () {
							const plugin = plugins.find(({ id }) => id === provider.pluginId);
							const script =
								plugin && provider.scriptSlug
									? yield* runtime.findScriptInAvailablePlugin(plugin, provider.scriptSlug)
									: null;
							return { script, provider };
						}),
					);
				},
			);

			const listForUser = Effect.fn("IntegrationProviderCatalog.listForUser")(function* (
				userId: UserId,
			) {
				return fromAvailablePlugins(yield* runtime.listPluginsAvailableToUser(userId));
			});

			const findForUser = Effect.fn("IntegrationProviderCatalog.findForUser")(function* (
				userId: UserId,
				providerSlug: string,
			) {
				return (yield* listForUser(userId)).find(({ slug }) => slug === providerSlug) ?? null;
			});

			const findOwnedForUser = Effect.fn("IntegrationProviderCatalog.findOwnedForUser")(function* (
				userId: UserId,
				providerSlug: string,
				installationId: string,
			) {
				return (
					(yield* listForUser(userId)).find(
						(provider) =>
							provider.slug === providerSlug && provider.installationId === installationId,
					) ?? null
				);
			});

			const resolveOwnedForUser = Effect.fn("IntegrationProviderCatalog.resolveOwnedForUser")(
				function* (userId: UserId, providerSlug: string, installationId: string) {
					return (
						(yield* listResolvedForUser(userId)).find(
							({ provider }) =>
								provider.slug === providerSlug && provider.installationId === installationId,
						) ?? null
					);
				},
			);

			return {
				listForUser,
				findForUser,
				findOwnedForUser,
				listResolvedForUser,
				resolveOwnedForUser,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export const IntegrationProviderCatalogLive = IntegrationProviderCatalog.layer.pipe(
	Layer.provide(PluginRuntimeResolverLive),
);
