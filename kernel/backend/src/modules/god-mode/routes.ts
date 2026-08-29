import { AppContract } from "@ryot-app/contract/contract";
import { DbError } from "@ryot-app/contract/errors";
import { GodModeInternalFailure } from "@ryot-app/contract/modules/god-mode/contract";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { GodModeService } from "./service";

const mapPersistenceFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	effect.pipe(
		Effect.catchIf(
			(error): error is Extract<E, DbError> => error instanceof DbError,
			() => Effect.fail(new GodModeInternalFailure({ reason: { code: "persistence-failed" } })),
		),
	);

export const GodModeRoutesLive = HttpApiBuilder.group(AppContract, "godMode", (handlers) =>
	handlers
		.handle("getMigrationReport", () =>
			Effect.gen(function* () {
				const service = yield* GodModeService;
				return yield* mapPersistenceFailure(service.getMigrationReport());
			}),
		)
		.handle("listUsers", ({ query }) =>
			Effect.gen(function* () {
				const service = yield* GodModeService;
				return yield* mapPersistenceFailure(service.listUsers(query));
			}),
		)
		.handle("provisionUser", ({ payload }) =>
			Effect.gen(function* () {
				const service = yield* GodModeService;
				return yield* mapPersistenceFailure(service.provisionUser(payload));
			}),
		)
		.handle("resetUserPassword", ({ params }) =>
			Effect.gen(function* () {
				const service = yield* GodModeService;
				return yield* mapPersistenceFailure(service.resetUserPassword(params.userId));
			}),
		)
		.handle("resetUser", ({ params }) =>
			Effect.gen(function* () {
				const service = yield* GodModeService;
				return yield* mapPersistenceFailure(service.resetUser(params.userId));
			}),
		)
		.handle("setUserDisabled", ({ params, payload }) =>
			Effect.gen(function* () {
				const service = yield* GodModeService;
				return yield* mapPersistenceFailure(
					service.setUserDisabled(params.userId, payload.disabled),
				);
			}),
		)
		.handle("deleteUser", ({ params }) =>
			Effect.gen(function* () {
				const service = yield* GodModeService;
				return yield* mapPersistenceFailure(service.deleteUser(params.userId));
			}),
		)
		.handle("getUserLifecycleOperation", ({ params }) =>
			Effect.gen(function* () {
				const service = yield* GodModeService;
				return yield* mapPersistenceFailure(service.getUserLifecycleOperation(params.operationId));
			}),
		),
);
