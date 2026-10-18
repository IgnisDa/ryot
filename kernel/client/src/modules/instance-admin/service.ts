import type { ContractSuccess } from "@ryot-app/contract/client";
import type { ImpersonationAuthorization } from "@ryot-app/contract/oauth";
import { UserId } from "@ryot-app/contract/schema/brands";
import {
	type InstanceAdminUsersPage,
	instanceAdminUsersRecipe,
	type MigrationReportPage,
	migrationReportRecipe,
	userLifecycleOperationRecipe,
} from "@ryot-app/ryotql-recipes/instance-admin";
import { Context, Data, Effect, Layer } from "effect";

import { InstanceAdminApi } from "#/api/instance-admin";
import { InstanceAdminSessionService } from "#/modules/instance-admin/session";
import {
	type InstanceAdminUserResetResult,
	runUserLifecycleOperation,
} from "#/modules/instance-admin/user-lifecycle";

export type InstanceAdminUsers = InstanceAdminUsersPage;
export type InstanceAdminMigrationReport = MigrationReportPage;
export type InstanceAdminUser = InstanceAdminUsers["items"][number];
export type InstanceAdminLogs = ContractSuccess<"serverLogs", "list">;
export type InstanceAdminSetDisabledResult = ContractSuccess<"instanceAdmin", "setUserDisabled">;
export type InstanceAdminPasswordResetResult = ContractSuccess<
	"instanceAdmin",
	"resetUserPassword"
>;

export class InstanceAdminSessionNotFound extends Data.TaggedError("InstanceAdminSessionNotFound")<{
	readonly sessionId: string;
}> {}

export class InstanceAdminResetResultMissing extends Data.TaggedError(
	"InstanceAdminResetResultMissing",
)<{ readonly operationId: string }> {}

export class InstanceAdminService extends Context.Service<InstanceAdminService>()(
	"InstanceAdminService",
	{
		make: Effect.gen(function* () {
			const api = yield* InstanceAdminApi;
			const sessions = yield* InstanceAdminSessionService;
			const credentials = Effect.fn("InstanceAdminService.credentials")(function* (
				sessionId: string,
			) {
				const session = yield* sessions.get(sessionId);
				if (session === null) {
					return yield* new InstanceAdminSessionNotFound({ sessionId });
				}
				return session;
			});
			const listLogs = Effect.fn("InstanceAdminService.listLogs")(function* (
				sessionId: string,
				after: string | undefined,
				limit: number,
			) {
				const { token, origin } = yield* credentials(sessionId);
				return yield* api.listLogs(origin, token, after, limit);
			});
			const downloadLogs = Effect.fn("InstanceAdminService.downloadLogs")(function* (
				sessionId: string,
				file?: InstanceAdminLogs["files"][number],
			) {
				const { token, origin } = yield* credentials(sessionId);
				yield* api.downloadLogs(origin, token, file);
			});
			const listUsers = Effect.fn("InstanceAdminService.listUsers")(function* (
				sessionId: string,
				search: string,
				after: string | undefined,
				limit: number,
			) {
				const { token, origin } = yield* credentials(sessionId);
				return yield* api.query(origin, token, instanceAdminUsersRecipe({ limit, after, search }));
			});
			const getMigrationReport = Effect.fn("InstanceAdminService.getMigrationReport")(function* (
				sessionId: string,
				after?: string,
			) {
				const { token, origin } = yield* credentials(sessionId);
				return yield* api.query(origin, token, migrationReportRecipe({ after, limit: 50 }));
			});
			const resetUserPassword = Effect.fn("InstanceAdminService.resetUserPassword")(function* (
				sessionId: string,
				userId: string,
			) {
				const { token, origin } = yield* credentials(sessionId);
				return yield* api.resetUserPassword(origin, token, {
					params: { userId: UserId.make(userId) },
				});
			});
			const setUserDisabled = Effect.fn("InstanceAdminService.setUserDisabled")(function* (
				sessionId: string,
				userId: string,
				disabled: boolean,
			) {
				const { token, origin } = yield* credentials(sessionId);
				return yield* api.setUserDisabled(origin, token, {
					payload: { disabled },
					params: { userId: UserId.make(userId) },
				});
			});
			const startUserImpersonation = Effect.fn("InstanceAdminService.startUserImpersonation")(
				function* (sessionId: string, userId: string, authorization: ImpersonationAuthorization) {
					const { token, origin } = yield* credentials(sessionId);
					return yield* api.startUserImpersonation(origin, token, {
						payload: authorization,
						params: { userId: UserId.make(userId) },
					});
				},
			);
			const lifecycle = Effect.fn("InstanceAdminService.lifecycle")(function* (
				sessionId: string,
				userId: string,
				kind: "reset" | "delete",
			) {
				const { token, origin } = yield* credentials(sessionId);
				const params = { userId: UserId.make(userId) };
				return yield* runUserLifecycleOperation({
					poll: (operationId) =>
						api.query(origin, token, userLifecycleOperationRecipe({ id: operationId })),
					start:
						kind === "delete"
							? api.deleteUser(origin, token, { params })
							: api.resetUser(origin, token, { params }),
				});
			});
			const deleteUser = Effect.fn("InstanceAdminService.deleteUser")(
				(sessionId: string, userId: string) => lifecycle(sessionId, userId, "delete"),
			);
			const resetUser = Effect.fn("InstanceAdminService.resetUser")(function* (
				sessionId: string,
				userId: string,
			) {
				const operation = yield* lifecycle(sessionId, userId, "reset");
				if (operation.resetResult === null) {
					return yield* new InstanceAdminResetResultMissing({ operationId: operation.id });
				}
				return operation.resetResult satisfies InstanceAdminUserResetResult;
			});

			return {
				listLogs,
				listUsers,
				resetUser,
				deleteUser,
				downloadLogs,
				setUserDisabled,
				resetUserPassword,
				getMigrationReport,
				startUserImpersonation,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
