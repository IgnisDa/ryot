import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { CurrentUser } from "#lib/auth-middleware";
import { AppContract } from "#lib/contract";
import { dieOnDbError } from "#lib/errors";

import { EventsService } from "./service";

export const EventsRoutesLive = HttpApiBuilder.group(AppContract, "events", (handlers) =>
	handlers
		.handle("list", ({ urlParams }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* EventsService;
				return yield* service.listForUser(user.id, urlParams).pipe(dieOnDbError);
			}),
		)
		.handle("create", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* EventsService;
				return yield* service
					.create({ userId: user.id, payload, source: "api" })
					.pipe(dieOnDbError);
			}),
		),
);
