import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { AppContract } from "#lib/contract";
import { dieOnDbError } from "#lib/errors";

import { GodModeService } from "./service";

export const GodModeRoutesLive = HttpApiBuilder.group(AppContract, "godMode", (handlers) =>
	handlers
		.handle("listUsers", ({ urlParams }) =>
			Effect.gen(function* () {
				const service = yield* GodModeService;
				return yield* service.listUsers(urlParams).pipe(dieOnDbError);
			}),
		)
		.handle("provisionUser", ({ payload }) =>
			Effect.gen(function* () {
				const service = yield* GodModeService;
				return yield* service.provisionUser(payload).pipe(dieOnDbError);
			}),
		)
		.handle("resetUserPassword", ({ path }) =>
			Effect.gen(function* () {
				const service = yield* GodModeService;
				return yield* service.resetUserPassword(path.userId).pipe(dieOnDbError);
			}),
		)
		.handle("setUserDisabled", ({ path, payload }) =>
			Effect.gen(function* () {
				const service = yield* GodModeService;
				return yield* service.setUserDisabled(path.userId, payload.disabled).pipe(dieOnDbError);
			}),
		),
);
