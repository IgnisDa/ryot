import type { CalendarSourceSlug, PluginId, UserId } from "@ryot-app/contract/schema/brands";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DefinitionCatalog } from "#modules/definitions/catalog";
import { DatabaseSession } from "#platform/db/session";
import * as schema from "#schema/tables/combined";

type CalendarSourceIdentity = {
	readonly slug: string;
	readonly userId: UserId;
	readonly pluginId: string;
};

export class CalendarSourcesRepository extends Context.Service<CalendarSourcesRepository>()(
	"@ryot-app/kernel-backend/modules/calendar-sources/repository/CalendarSourcesRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const catalogs = yield* DefinitionCatalog;
			const findEffective = Effect.fn("CalendarSourcesRepository.findEffective")(function* (
				userId: UserId,
				pluginId: PluginId,
				slug: CalendarSourceSlug,
			) {
				const row = (yield* catalogs.forUser(userId)).calendarSources.find(
					(source) => source.isEffective && source.pluginId === pluginId && source.slug === slug,
				);
				return row ? { slug: row.slug, pluginId: row.pluginId } : null;
			});
			const setHidden = Effect.fn("CalendarSourcesRepository.setHidden")(function* (
				source: CalendarSourceIdentity,
				isHidden: boolean,
			) {
				if (!isHidden) {
					yield* session.run((db) =>
						db
							.delete(schema.calendarSourceOverride)
							.where(
								and(
									eq(schema.calendarSourceOverride.userId, source.userId),
									eq(schema.calendarSourceOverride.pluginId, source.pluginId),
									eq(schema.calendarSourceOverride.slug, source.slug),
								),
							),
					);
					return;
				}
				yield* session.run((db) =>
					db
						.insert(schema.calendarSourceOverride)
						.values({ ...source, isHidden })
						.onConflictDoUpdate({
							set: { isHidden },
							target: [
								schema.calendarSourceOverride.userId,
								schema.calendarSourceOverride.pluginId,
								schema.calendarSourceOverride.slug,
							],
						}),
				);
			});
			return { setHidden, findEffective };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(DefinitionCatalog.layer),
	);
}
