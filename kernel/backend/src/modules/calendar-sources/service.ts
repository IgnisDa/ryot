import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	CalendarSourceNotFound,
	type SetCalendarSourceVisibilityBody,
} from "@ryot-app/contract/modules/calendar-sources/schemas";
import { Context, Effect, Layer } from "effect";

import { mapDatabaseErrors } from "#platform/db/errors";
import { DatabaseSession } from "#platform/db/session";

import { CalendarSourcesRepository } from "./repository";

export class CalendarSourcesService extends Context.Service<CalendarSourcesService>()(
	"CalendarSourcesService",
	{
		make: Effect.gen(function* () {
			const repository = yield* CalendarSourcesRepository;
			const session = yield* DatabaseSession;
			const setVisibility = Effect.fn("CalendarSourcesService.setVisibility")(function* (
				user: Pick<CurrentUserValue, "id">,
				payload: SetCalendarSourceVisibilityBody,
			) {
				yield* mapDatabaseErrors(
					session
						.transaction(
							Effect.gen(function* () {
								yield* session.acquireUserWriteLock(user.id);
								const source = yield* repository.findEffective(
									user.id,
									payload.pluginId,
									payload.slug,
								);
								if (!source) {
									return yield* new CalendarSourceNotFound({
										reason: { code: "calendar-source-not-found" },
									});
								}
								return yield* repository.setHidden(
									{ userId: user.id, slug: source.slug, pluginId: source.pluginId },
									payload.isHidden,
								);
							}),
						)
						.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die)),
				);
				return payload;
			});
			return { setVisibility };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
