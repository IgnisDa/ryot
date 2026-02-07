import { HttpApiBuilder } from "@effect/platform";
import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";

import { UserPreferencesService } from "./service";

export const UserPreferencesRoutesLive = HttpApiBuilder.group(
	AppContract,
	"userPreferences",
	(handlers) =>
		handlers.handle("update", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* UserPreferencesService;
				return yield* service.update(user, payload).pipe(dieOnDbError);
			}),
		),
);
