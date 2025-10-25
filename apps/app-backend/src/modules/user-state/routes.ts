import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { CurrentUser } from "#lib/auth";
import { AppContract } from "#lib/contract";
import { dieOnDbError } from "#lib/errors";

import { UserStateService } from "./service";

export const UserStateRoutesLive = HttpApiBuilder.group(AppContract, "userState", (handlers) =>
	handlers.handle("clearUserState", ({ path }) =>
		Effect.gen(function* () {
			const user = yield* CurrentUser;
			const service = yield* UserStateService;
			return yield* service.clearUserState(user, path.entityId).pipe(dieOnDbError);
		}),
	),
);
