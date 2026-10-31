import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError } from "@ryot-app/contract/errors";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { RemindersService } from "./service";

export const RemindersRoutesLive = HttpApiBuilder.group(AppContract, "reminders", (handlers) =>
	handlers
		.handle("deliveryConfiguration", () =>
			Effect.flatMap(RemindersService, (service) => service.deliveryConfiguration),
		)
		.handle("create", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* RemindersService;
				return yield* service.create(user, payload).pipe(dieOnDbError);
			}),
		)
		.handle("edit", ({ params, payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* RemindersService;
				return yield* service.edit(user, params.reminderId, payload).pipe(dieOnDbError);
			}),
		)
		.handle("cancel", ({ params, payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* RemindersService;
				return yield* service.cancel(user, params.reminderId, payload).pipe(dieOnDbError);
			}),
		)
		.handle("remove", ({ params, payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* RemindersService;
				return yield* service.remove(user, params.reminderId, payload).pipe(dieOnDbError);
			}),
		),
);
