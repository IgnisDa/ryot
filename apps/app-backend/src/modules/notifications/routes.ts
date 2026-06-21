import { HttpApiBuilder } from "@effect/platform";
import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";

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
			.handle("updateChannel", ({ path, payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* NotificationsService;
					return yield* service.update(user, path.channelId, payload).pipe(dieOnDbError);
				}),
			)
			.handle("deleteChannel", ({ path }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* NotificationsService;
					return yield* service.delete(user, path.channelId).pipe(dieOnDbError);
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
