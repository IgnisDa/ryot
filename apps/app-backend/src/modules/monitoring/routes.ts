import { HttpApiBuilder } from "@effect/platform";
import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";

import { MonitoringService } from "./service";

export const MonitoringRoutesLive = HttpApiBuilder.group(AppContract, "monitoring", (handlers) =>
	handlers
		.handle("status", ({ path }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* MonitoringService;
				return yield* service.get(user, path.entityId).pipe(dieOnDbError);
			}),
		)
		.handle("enable", ({ path }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* MonitoringService;
				return yield* service.enable(user, path.entityId).pipe(dieOnDbError);
			}),
		)
		.handle("disable", ({ path }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* MonitoringService;
				return yield* service.disable(user, path.entityId).pipe(dieOnDbError);
			}),
		),
);
