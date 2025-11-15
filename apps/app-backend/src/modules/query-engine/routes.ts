import { HttpApiBuilder } from "@effect/platform";
import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { Effect } from "effect";

import { QueryEngineService } from "./service";

export const QueryEngineRoutesLive = HttpApiBuilder.group(AppContract, "queryEngine", (handlers) =>
	handlers.handle("execute", ({ payload }) =>
		Effect.gen(function* () {
			const user = yield* CurrentUser;
			const service = yield* QueryEngineService;
			return yield* service.execute(user, payload);
		}),
	),
);
