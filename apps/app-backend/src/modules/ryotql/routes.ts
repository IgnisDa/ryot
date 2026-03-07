import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { RyotQLService } from "./service";

export const RyotQLRoutesLive = HttpApiBuilder.group(AppContract, "ryotql", (handlers) =>
	handlers.handle("execute", ({ payload }) =>
		Effect.gen(function* () {
			const user = yield* CurrentUser;
			const service = yield* RyotQLService;
			return yield* service.execute(user, payload).pipe(dieOnDbError);
		}),
	),
);
