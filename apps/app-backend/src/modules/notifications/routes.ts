import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { NotificationsService } from "./service";

export const NotificationsRoutesLive = HttpApiBuilder.group(
	AppContract,
	"notifications",
	(handlers) =>
		handlers
			.handle("listChannels", () =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* NotificationsService;
					return yield* service.list(user).pipe(dieOnDbError);
				}),
			)
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
