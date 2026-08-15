import type { ContractSuccess } from "@ryot-app/contract/client";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Data, Effect, Layer } from "effect";

import { GodModeApi } from "#/api/god-mode";
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
		const api = yield* GodModeApi;
		const sessions = yield* GodModeSessionService;
		const credentials = Effect.fn("GodModeService.credentials")(function* (sessionId: string) {
			const session = yield* sessions.get(sessionId);
			if (session === null) {
				return yield* new GodModeSessionNotFound({ sessionId });
			}
			return session;
		});
		const listUsers = Effect.fn("GodModeService.listUsers")(function* (
			sessionId: string,
			search: string,
			offset: number,
			limit: number,
		) {
			const { origin, token } = yield* credentials(sessionId);
			return yield* api.listUsers(origin, token, {
				query: { offset, limit, ...(search === "" ? {} : { search }) },
			});
		});
		const getMigrationReport = Effect.fn("GodModeService.getMigrationReport")(function* (
			sessionId: string,
		) {
			const { origin, token } = yield* credentials(sessionId);
			return yield* api.getMigrationReport(origin, token);
		});
		const resetUserPassword = Effect.fn("GodModeService.resetUserPassword")(function* (
			sessionId: string,
			userId: string,
		) {
			const { origin, token } = yield* credentials(sessionId);
			return yield* api.resetUserPassword(origin, token, {
				params: { userId: UserId.make(userId) },
			});
		});
		const setUserDisabled = Effect.fn("GodModeService.setUserDisabled")(function* (
			sessionId: string,
			userId: string,
			disabled: boolean,
		) {
			const { origin, token } = yield* credentials(sessionId);
			return yield* api.setUserDisabled(origin, token, {
				payload: { disabled },
				params: { userId: UserId.make(userId) },
			});
		});
		const lifecycle = Effect.fn("GodModeService.lifecycle")(function* (
			sessionId: string,
			userId: string,
			kind: "delete" | "reset",
		) {
			const { origin, token } = yield* credentials(sessionId);
			const params = { userId: UserId.make(userId) };
			return yield* runUserLifecycleOperation({
				poll: (operationId) =>
					api.getUserLifecycleOperation(origin, token, { params: { operationId } }),
				start:
					kind === "delete"
						? api.deleteUser(origin, token, { params })
						: api.resetUser(origin, token, { params }),
			});
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
