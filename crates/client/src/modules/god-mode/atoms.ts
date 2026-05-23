import type { ContractSuccess } from "@ryot/contract/client";
import { UserId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";
import { Atom, Reactivity } from "effect/unstable/reactivity";

import { adminClient, type AdminSession, canonicalAdminSession } from "@/api/admin-api";
import { adminRequestKey } from "@/api/request-key";
import { runUserLifecycleOperation } from "@/modules/god-mode/user-lifecycle";

export type GodModeUser = ContractSuccess<"godMode", "listUsers">["users"][number];
export const GOD_MODE_USERS_PAGE_SIZE = 50;
export type MigrationReportEntry = ContractSuccess<
	"godMode",
	"getMigrationReport"
>["entries"][number];
export type GodModePasswordResetResult = ContractSuccess<"godMode", "resetUserPassword">;
export type GodModeSetDisabledResult = ContractSuccess<"godMode", "setUserDisabled">;

type GodModeUserRequest = AdminSession & { readonly userId: string };
type GodModeUsersRequest = AdminSession & { readonly search: string; readonly offset: number };

const usersReactivityKey = (session: AdminSession) => [
	`god-mode-users:${adminRequestKey(session.serverUrl, session.sessionId)}`,
];

const migrationReportReactivityKey = (session: AdminSession) => [
	`god-mode-migration-report:${adminRequestKey(session.serverUrl, session.sessionId)}`,
];

const migrationReportFamily = Atom.family((session: AdminSession) =>
	adminClient(session).query("godMode", "getMigrationReport", {
		reactivityKeys: migrationReportReactivityKey(session),
	}),
);

const usersPageFamily = Atom.family((request: GodModeUsersRequest) =>
	adminClient(request).query("godMode", "listUsers", {
		reactivityKeys: usersReactivityKey(request),
		query: {
			offset: request.offset,
			limit: GOD_MODE_USERS_PAGE_SIZE,
			...(request.search === "" ? {} : { search: request.search }),
		},
	}),
);

const deleteUserFamily = Atom.family((request: GodModeUserRequest) => {
	const client = adminClient(request);
	return client.runtime.fn(() =>
		Effect.flatMap(client.request, (contract) =>
			Reactivity.mutation(
				runUserLifecycleOperation({
					poll: (operationId) =>
						contract.godMode.getUserLifecycleOperation({ params: { operationId } }),
					start: contract.godMode.deleteUser({ params: { userId: UserId.make(request.userId) } }),
				}),
				usersReactivityKey(request),
			),
		),
	);
});

const resetUserFamily = Atom.family((request: GodModeUserRequest) => {
	const client = adminClient(request);
	return client.runtime.fn(() =>
		Effect.flatMap(client.request, (contract) =>
			Reactivity.mutation(
				runUserLifecycleOperation({
					poll: (operationId) =>
						contract.godMode.getUserLifecycleOperation({ params: { operationId } }),
					start: contract.godMode.resetUser({ params: { userId: UserId.make(request.userId) } }),
				}).pipe(
					Effect.flatMap((operation) =>
						operation.resetResult === null
							? Effect.logWarning("completed god-mode reset had no reset result", operation).pipe(
									Effect.andThen(Effect.fail(operation)),
								)
							: Effect.succeed(operation.resetResult),
					),
				),
				usersReactivityKey(request),
			),
		),
	);
});

const resetUserPasswordFamily = Atom.family((request: GodModeUserRequest) => {
	const client = adminClient(request);
	return client.runtime.fn(() =>
		Effect.flatMap(client.request, (contract) =>
			contract.godMode.resetUserPassword({ params: { userId: UserId.make(request.userId) } }),
		),
	);
});

const setUserDisabledFamily = Atom.family((request: GodModeUserRequest) => {
	const client = adminClient(request);
	return client.runtime.fn((disabled: boolean) =>
		Effect.flatMap(client.request, (contract) =>
			Reactivity.mutation(
				contract.godMode.setUserDisabled({
					payload: { disabled },
					params: { userId: UserId.make(request.userId) },
				}),
				usersReactivityKey(request),
			),
		),
	);
});

const canonicalUserRequest = (request: GodModeUserRequest) => ({
	...canonicalAdminSession(request),
	userId: request.userId,
});

export const godModeUsersPageAtom = (request: GodModeUsersRequest) =>
	usersPageFamily({
		...canonicalAdminSession(request),
		search: request.search,
		offset: request.offset,
	});

export const migrationReportAtom = (session: AdminSession) =>
	migrationReportFamily(canonicalAdminSession(session));

export const deleteUserAtom = (request: GodModeUserRequest) =>
	deleteUserFamily(canonicalUserRequest(request));

export const resetUserAtom = (request: GodModeUserRequest) =>
	resetUserFamily(canonicalUserRequest(request));

export const resetUserPasswordAtom = (request: GodModeUserRequest) =>
	resetUserPasswordFamily(canonicalUserRequest(request));

export const setUserDisabledAtom = (request: GodModeUserRequest) =>
	setUserDisabledFamily(canonicalUserRequest(request));
