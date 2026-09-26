import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError } from "@ryot-app/contract/errors";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { UserSettingsService } from "./service";

export const UserSettingsRoutesLive = HttpApiBuilder.group(
	AppContract,
	"userSettings",
	(handlers) =>
		handlers
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
