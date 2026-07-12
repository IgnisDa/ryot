import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { GodModeService } from "./service";

export const GodModeRoutesLive = HttpApiBuilder.group(AppContract, "godMode", (handlers) =>
	handlers
		.handle("listUsers", ({ query }) =>
			Effect.gen(function* () {
				const service = yield* GodModeService;
				return yield* service.listUsers(query).pipe(dieOnDbError);
			}),
		)
		.handle("provisionUser", ({ payload }) =>
			Effect.gen(function* () {
				const service = yield* GodModeService;
				return yield* service.provisionUser(payload).pipe(dieOnDbError);
			}),
		)
		.handle("resetUserPassword", ({ params }) =>
			Effect.gen(function* () {
				const service = yield* GodModeService;
				return yield* service.resetUserPassword(params.userId).pipe(dieOnDbError);
			}),
		)
		.handle("resetUser", ({ params }) =>
			Effect.gen(function* () {
				const service = yield* GodModeService;
				return yield* service.resetUser(params.userId).pipe(dieOnDbError);
			}),
		)
		.handle("setUserDisabled", ({ params, payload }) =>
			Effect.gen(function* () {
				const service = yield* GodModeService;
				return yield* service.setUserDisabled(params.userId, payload.disabled).pipe(dieOnDbError);
			}),
		)
		.handle("deleteUser", ({ params }) =>
			Effect.gen(function* () {
				const service = yield* GodModeService;
				return yield* service.deleteUser(params.userId).pipe(dieOnDbError);
			}),
		),
);
