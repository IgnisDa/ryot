import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError } from "@ryot-app/contract/errors";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { NotificationsService } from "./service";

export const NotificationsRoutesLive = HttpApiBuilder.group(
	AppContract,
	"notifications",
	(handlers) =>
		handlers
			.handle("createChannel", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* NotificationsService;
					return yield* service.create(user, payload).pipe(dieOnDbError);
				}),
			)
			.handle("updateChannel", ({ params, payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* NotificationsService;
					return yield* service.update(user, params.channelId, payload).pipe(dieOnDbError);
				}),
			)
			.handle("deleteChannel", ({ params }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* NotificationsService;
					return yield* service.delete(user, params.channelId).pipe(dieOnDbError);
				}),
			)
			.handle("testChannels", () =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* NotificationsService;
					return yield* service.test(user);
				}),
			),
);
