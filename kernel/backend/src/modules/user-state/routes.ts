import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError } from "@ryot-app/contract/errors";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { UserStateService } from "./service";

export const UserStateRoutesLive = HttpApiBuilder.group(AppContract, "userState", (handlers) =>
	handlers
		.handle("clearUserState", ({ params }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* UserStateService;
				return yield* service.clearUserState(user, params.entityId).pipe(dieOnDbError);
			}),
		)
		.handle("mergeUserState", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* UserStateService;
				return yield* service.mergeUserState(user, payload).pipe(dieOnDbError);
			}),
		),
);
