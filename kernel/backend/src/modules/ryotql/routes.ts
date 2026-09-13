import { AuthorizationContext, CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { RyotQLService } from "./service";

export const RyotQLRoutesLive = HttpApiBuilder.group(AppContract, "ryotql", (handlers) =>
	handlers
		.handle("execute", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const authorization = yield* AuthorizationContext;
				const service = yield* RyotQLService;
				return yield* service.execute(user, payload, authorization.accessClass);
			}),
		)
		.handle("executePlugin", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const authorization = yield* AuthorizationContext;
				const service = yield* RyotQLService;
				return yield* service.executeForPluginAudience(user, payload, authorization.accessClass);
			}),
		),
);

export const AdminRyotQLRoutesLive = HttpApiBuilder.group(AppContract, "adminRyotql", (handlers) =>
	handlers.handle("execute", ({ payload }) =>
		Effect.gen(function* () {
			const service = yield* RyotQLService;
			return yield* service.executeForAdmin(payload);
		}),
	),
);
