import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { CurrentUser } from "#lib/auth-middleware";
import { AppContract } from "#lib/contract";

import { QueryEngineV2Service } from "./service";

export const QueryEngineV2RoutesLive = HttpApiBuilder.group(
	AppContract,
	"queryEngineV2",
	(handlers) =>
		handlers.handle("execute", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* QueryEngineV2Service;
				return yield* service.execute(user, payload);
			}),
		),
);
