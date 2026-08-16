import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { DbError } from "@ryot-app/contract/errors";
import { EventsInternalError } from "@ryot-app/contract/modules/events/schemas";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { EventsService } from "./service";

export const EventsRoutesLive = HttpApiBuilder.group(AppContract, "events", (handlers) =>
	handlers.handle("create", ({ payload }) =>
		Effect.gen(function* () {
			const user = yield* CurrentUser;
			const service = yield* EventsService;
			return yield* service.create({ userId: user.id, payload, source: "api" }).pipe(
				Effect.catchTag("EventCreateItemError", (error) =>
					Effect.logError("event creation escaped item failure handling", error).pipe(
						Effect.andThen(new EventsInternalError({ reason: { code: "unexpected-error" } })),
					),
				),
				Effect.catchIf(
					(error): error is DbError => error instanceof DbError,
					(error) =>
						Effect.logError("event creation failed", error).pipe(
							Effect.andThen(new EventsInternalError({ reason: { code: "unexpected-error" } })),
						),
				),
			);
		}),
	),
);
