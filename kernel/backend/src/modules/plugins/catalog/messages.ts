import type { PluginLocaleCatalogs } from "@ryot-app/contract/modules/plugins/schemas";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { and, eq, inArray } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DefinitionCatalog } from "#modules/definitions/catalog";
import { DatabaseSession } from "#platform/db/session";
import { MessageCatalogSource, MessageRegistry } from "#platform/messages";
import * as schema from "#schema/tables/combined";

export const PluginMessageCatalogSourceLive = Layer.effect(
	MessageCatalogSource,
	Effect.gen(function* () {
		const database = yield* DatabaseSession;
		return {
			load: (namespaces: ReadonlyArray<string>, locale: string) =>
				database.run((db) =>
					db
						.select({ namespace: schema.plugin.id, catalog: schema.pluginRevisionCatalog.catalog })
						.from(schema.plugin)
						.innerJoin(
							schema.pluginRevisionCatalog,
							eq(schema.pluginRevisionCatalog.pluginRevisionId, schema.plugin.activeRevisionId),
						)
						.where(
							and(
								eq(schema.plugin.status, "active"),
								inArray(schema.plugin.id, namespaces),
								eq(schema.pluginRevisionCatalog.locale, locale),
							),
						)
						.orderBy(schema.plugin.id),
				),
		};
	}),
);

export class PluginMessageCatalogs extends Context.Service<PluginMessageCatalogs>()(
	"@ryot-app/kernel-backend/modules/plugins/catalog/messages/PluginMessageCatalogs",
	{
		make: Effect.gen(function* () {
			const source = yield* MessageCatalogSource;
			const definitions = yield* DefinitionCatalog;
			const forUser = Effect.fn("PluginMessageCatalogs.forUser")(function* (
				userId: UserId,
				locale: string,
			) {
				const plugins = (yield* definitions.userPlugins(userId)).filter(
					(plugin) => plugin.isListed,
				);
				return {
					catalogs: yield* source.load(
						plugins.map((plugin) => plugin.pluginId),
						locale,
					),
				} satisfies PluginLocaleCatalogs;
			});
			return { forUser };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(DefinitionCatalog.layer),
		Layer.provide(PluginMessageCatalogSourceLive),
	);
}

export const PluginMessageRegistryLive = MessageRegistry.layer.pipe(
	Layer.provide(PluginMessageCatalogSourceLive),
);
