import { AuthorizationContext, CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { RyotQLService } from "./service";

export const RyotQLRoutesLive = HttpApiBuilder.group(AppContract, "ryotql", (handlers) =>
	handlers
		.handle("describe", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const authorization = yield* AuthorizationContext;
				return yield* (yield* RyotQLService).describe(
					user,
					payload.source,
					"kernel",
					authorization.accessClass,
					payload.arguments,
				);
			}),
		)
		.handle("describePlugin", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const authorization = yield* AuthorizationContext;
				return yield* (yield* RyotQLService).describe(
					user,
					payload.source,
					"plugin",
					authorization.accessClass,
					payload.arguments,
				);
			}),
		)
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
	handlers
		.handle("describe", ({ payload }) =>
			Effect.flatMap(RyotQLService, (service) =>
				service.describeForAdmin(payload.source, payload.arguments),
			),
		)
		.handle("execute", ({ payload }) =>
			Effect.gen(function* () {
				const service = yield* RyotQLService;
				return yield* service.executeForAdmin(payload);
			}),
		),
);
