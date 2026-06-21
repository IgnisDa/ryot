import { HttpApiBuilder } from "@effect/platform";
import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";

import { MediaMonitoringService } from "./service";

export const MediaMonitoringRoutesLive = HttpApiBuilder.group(
	AppContract,
	"mediaMonitoring",
	(handlers) =>
		handlers
			.handle("status", ({ path }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* MediaMonitoringService;
					return yield* service.get(user, path.entityId).pipe(dieOnDbError);
				}),
			)
			.handle("enable", ({ path }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* MediaMonitoringService;
					return yield* service.enable(user, path.entityId).pipe(dieOnDbError);
				}),
			)
			.handle("disable", ({ path }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* MediaMonitoringService;
					return yield* service.disable(user, path.entityId).pipe(dieOnDbError);
				}),
			),
);
