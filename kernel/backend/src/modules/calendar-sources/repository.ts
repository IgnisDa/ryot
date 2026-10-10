import type { CalendarSourceSlug, PluginId, UserId } from "@ryot-app/contract/schema/brands";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import * as schema from "#schema/tables/combined";

type CalendarSourceIdentity = {
	readonly userId: UserId;
	readonly pluginId: string;
	readonly slug: string;
};

export class CalendarSourcesRepository extends Context.Service<CalendarSourcesRepository>()(
	"CalendarSourcesRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const findEffective = Effect.fn("CalendarSourcesRepository.findEffective")(function* (
				userId: UserId,
				pluginId: PluginId,
				slug: CalendarSourceSlug,
			) {
				const [row] = yield* session.run((db) =>
					db
						.select({
							slug: schema.userCalendarSourceEffective.slug,
							pluginId: schema.userCalendarSourceEffective.pluginId,
						})
						.from(schema.userCalendarSourceEffective)
						.where(
							and(
								eq(schema.userCalendarSourceEffective.userId, userId),
								eq(schema.userCalendarSourceEffective.pluginId, pluginId),
								eq(schema.userCalendarSourceEffective.slug, slug),
								eq(schema.userCalendarSourceEffective.isEffective, true),
							),
						)
						.limit(1),
				);
				return row ?? null;
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
	static readonly layer = Layer.effect(this, this.make);
}
