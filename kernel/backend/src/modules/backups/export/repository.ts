import type { UserId } from "@ryot-app/contract/schema/brands";
import { asc, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import * as schema from "#schema/tables/combined";

export class BackupExportRepository extends Context.Service<BackupExportRepository>()(
	"BackupExportRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const listSavedViewOverrides = Effect.fn("BackupExportRepository.listSavedViewOverrides")(
				function* (userId: UserId) {
					return yield* session.run((db) =>
						db
							.select()
							.from(schema.savedViewOverride)
							.where(eq(schema.savedViewOverride.userId, userId))
							.orderBy(asc(schema.savedViewOverride.pluginId), asc(schema.savedViewOverride.slug)),
					);
				},
			);
			const listCalendarSourceOverrides = Effect.fn(
				"BackupExportRepository.listCalendarSourceOverrides",
			)(function* (userId: UserId) {
				return yield* session.run((db) =>
					db
						.select()
						.from(schema.calendarSourceOverride)
						.where(eq(schema.calendarSourceOverride.userId, userId))
						.orderBy(
							asc(schema.calendarSourceOverride.pluginId),
							asc(schema.calendarSourceOverride.slug),
						),
				);
			});
			return { listSavedViewOverrides, listCalendarSourceOverrides };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
