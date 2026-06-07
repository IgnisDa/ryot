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
			.handle("listPlatforms", () =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* NotificationsService;
					return yield* service.list(user).pipe(dieOnDbError);
				}),
			)
			.handle("createPlatform", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* NotificationsService;
					return yield* service.create(user, payload).pipe(dieOnDbError);
				}),
			)
			.handle("updatePlatform", ({ path, payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* NotificationsService;
					return yield* service.update(user, path.platformId, payload).pipe(dieOnDbError);
				}),
			)
			.handle("deletePlatform", ({ path }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* NotificationsService;
					return yield* service.delete(user, path.platformId).pipe(dieOnDbError);
				}),
			)
			.handle("testPlatforms", () =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* NotificationsService;
					return yield* service.test(user).pipe(dieOnDbError);
				}),
			),
);
