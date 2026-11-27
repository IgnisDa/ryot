import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError } from "@ryot-app/contract/errors";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { CalendarSourcesService } from "./service";

export const CalendarSourcesRoutesLive = HttpApiBuilder.group(
	AppContract,
	"calendarSources",
	(handlers) =>
		handlers.handle("setVisibility", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* CalendarSourcesService;
				return yield* service.setVisibility(user, payload).pipe(dieOnDbError);
			}),
		),
);
