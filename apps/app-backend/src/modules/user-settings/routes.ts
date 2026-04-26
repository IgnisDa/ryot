import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { UserSettingsService } from "./service";

export const UserSettingsRoutesLive = HttpApiBuilder.group(
	AppContract,
	"userSettings",
	(handlers) =>
		handlers
			.handle("get", () =>
				Effect.map(CurrentUser, (user) => ({
					id: user.id,
					name: user.name,
					email: user.email,
					image: user.image,
					preferences: user.preferences,
				})),
			)
			.handle("updatePreferences", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* UserSettingsService;
					return yield* service.updatePreferences(user, payload).pipe(dieOnDbError);
				}),
			)
			.handle("refreshAvatar", () =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* UserSettingsService;
					return yield* service.refreshAvatar(user).pipe(dieOnDbError);
				}),
			),
);
