import { HttpApiBuilder } from "@effect/platform";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";

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
		.handle("resetUser", ({ path }) =>
			Effect.gen(function* () {
				const service = yield* GodModeService;
				return yield* service.resetUser(path.userId).pipe(dieOnDbError);
			}),
		)
		.handle("setUserDisabled", ({ path, payload }) =>
			Effect.gen(function* () {
				const service = yield* GodModeService;
				return yield* service.setUserDisabled(path.userId, payload.disabled).pipe(dieOnDbError);
			}),
		)
		.handle("deleteUser", ({ path }) =>
			Effect.gen(function* () {
				const service = yield* GodModeService;
				return yield* service.deleteUser(path.userId).pipe(dieOnDbError);
			}),
		)
		.handle("triggerInfrequentCron", () =>
			Effect.gen(function* () {
				const service = yield* GodModeService;
				return yield* service.triggerInfrequentCron();
			}),
		),
);
