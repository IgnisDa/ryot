import type { UserId } from "@ryot-app/contract/schema/brands";
import { and, asc, eq, isNull } from "drizzle-orm";
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
			const listReminders = Effect.fn("BackupExportRepository.listReminders")(function* (
				userId: UserId,
			) {
				return yield* session.run((db) =>
					db
						.select()
						.from(schema.reminder)
						.where(and(eq(schema.reminder.userId, userId), isNull(schema.reminder.removedAt)))
						.orderBy(asc(schema.reminder.id)),
				);
			});
			return { listReminders, listSavedViewOverrides, listCalendarSourceOverrides };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
