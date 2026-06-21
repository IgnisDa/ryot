import type { ContractProgram, ContractSuccess } from "@ryot-app/contract/client";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Data, Effect, Layer } from "effect";

import { AdminApi } from "#/api/admin";
import { GodModeSessionService } from "#/modules/god-mode/session";
import {
	type GodModeUserResetResult,
	runUserLifecycleOperation,
} from "#/modules/god-mode/user-lifecycle";

export type GodModeUsers = ContractSuccess<"godMode", "listUsers">;
export type GodModeUser = ContractSuccess<"godMode", "listUsers">["users"][number];
export type GodModeSetDisabledResult = ContractSuccess<"godMode", "setUserDisabled">;
export type GodModeMigrationReport = ContractSuccess<"godMode", "getMigrationReport">;
export type GodModePasswordResetResult = ContractSuccess<"godMode", "resetUserPassword">;

export class GodModeSessionNotFound extends Data.TaggedError("GodModeSessionNotFound")<{
	readonly sessionId: string;
}> {}

export class GodModeResetResultMissing extends Data.TaggedError("GodModeResetResultMissing")<{
	readonly operationId: string;
}> {}

export class GodModeService extends Context.Service<GodModeService>()("GodModeService", {
	make: Effect.gen(function* () {
		const api = yield* AdminApi;
		const sessions = yield* GodModeSessionService;
		const run = <A, E>(sessionId: string, program: ContractProgram<A, E>) =>
			Effect.gen(function* () {
				const session = yield* sessions.get(sessionId);
				if (session === null) {
					return yield* new GodModeSessionNotFound({ sessionId });
				}
				return yield* api.run(session.origin, session.token, program);
			});
		const listUsers = Effect.fn("GodModeService.listUsers")(
			(sessionId: string, search: string, offset: number, limit: number) =>
				run(sessionId, (client) =>
					client.godMode.listUsers({
						query: { offset, limit, ...(search === "" ? {} : { search }) },
					}),
				),
		);
		const getMigrationReport = Effect.fn("GodModeService.getMigrationReport")((sessionId: string) =>
			run(sessionId, (client) => client.godMode.getMigrationReport()),
		);
		const resetUserPassword = Effect.fn("GodModeService.resetUserPassword")(
			(sessionId: string, userId: string) =>
				run(sessionId, (client) =>
					client.godMode.resetUserPassword({ params: { userId: UserId.make(userId) } }),
				),
		);
		const setUserDisabled = Effect.fn("GodModeService.setUserDisabled")(
			(sessionId: string, userId: string, disabled: boolean) =>
				run(sessionId, (client) =>
					client.godMode.setUserDisabled({
						payload: { disabled },
						params: { userId: UserId.make(userId) },
					}),
				),
		);
		const lifecycle = (sessionId: string, userId: string, kind: "delete" | "reset") =>
			runUserLifecycleOperation({
				poll: (operationId) =>
					run(sessionId, (client) =>
						client.godMode.getUserLifecycleOperation({ params: { operationId } }),
					),
				start: run(sessionId, (client) =>
					kind === "delete"
						? client.godMode.deleteUser({ params: { userId: UserId.make(userId) } })
						: client.godMode.resetUser({ params: { userId: UserId.make(userId) } }),
				),
			});
		const deleteUser = Effect.fn("GodModeService.deleteUser")((sessionId: string, userId: string) =>
			lifecycle(sessionId, userId, "delete"),
		);
		const resetUser = Effect.fn("GodModeService.resetUser")(function* (
			sessionId: string,
			userId: string,
		) {
			const operation = yield* lifecycle(sessionId, userId, "reset");
			if (operation.resetResult === null) {
				return yield* new GodModeResetResultMissing({ operationId: operation.id });
			}
			return operation.resetResult satisfies GodModeUserResetResult;
		});

		return {
			listUsers,
			resetUser,
			deleteUser,
			setUserDisabled,
			resetUserPassword,
			getMigrationReport,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
