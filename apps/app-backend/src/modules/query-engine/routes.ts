import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { CurrentUser } from "~/lib/auth";
import { AppContract } from "~/lib/contract";

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
