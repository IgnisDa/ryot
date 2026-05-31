import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { CurrentUser } from "#lib/auth-middleware";
import { AppContract } from "#lib/contract";
import { dieOnDbError } from "#lib/errors";

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
