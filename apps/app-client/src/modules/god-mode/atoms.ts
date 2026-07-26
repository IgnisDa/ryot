import type { ContractSuccess } from "@ryot/contract/client";
import { UserId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";
import { Atom, Reactivity } from "effect/unstable/reactivity";

import { makeAdminApi, makeAdminQueryApi } from "@/api/admin-api";
import { withAppQueryDefaults } from "@/api/client";
import { normalizeServerOrigin } from "@/api/origin";
import { adminRequestKey } from "@/api/request-key";
import { runUserLifecycleOperation } from "@/modules/god-mode/user-lifecycle";

export type GodModeUser = ContractSuccess<"godMode", "listUsers">["users"][number];
export type GodModePasswordResetResult = ContractSuccess<"godMode", "resetUserPassword">;
export type GodModeSetDisabledResult = ContractSuccess<"godMode", "setUserDisabled">;

export type GodModeScope = {
	readonly adminToken: string;
	readonly serverUrl: string;
	readonly sessionId: string;
};

type GodModeIdentity = Omit<GodModeScope, "adminToken">;

const canonicalGodModeIdentity = (scope: GodModeIdentity): GodModeIdentity => ({
	sessionId: scope.sessionId,
	serverUrl: normalizeServerOrigin(scope.serverUrl),
});

const createGodModeSession = (scope: GodModeScope) => {
	const identity = canonicalGodModeIdentity(scope);
	const key = adminRequestKey(identity.serverUrl, identity.sessionId);
	const api = makeAdminApi(identity.serverUrl, scope.adminToken);
	const queryApi = makeAdminQueryApi(identity.serverUrl, scope.adminToken);
	const usersReactivityKey = [`god-mode-users:${key}`];
	const deleteUser = Atom.family((userId: string) =>
		api.runtime.fn(() =>
			Effect.flatMap(api, (client) =>
				Reactivity.mutation(
					runUserLifecycleOperation({
						poll: (operationId) =>
							client.godMode.getUserLifecycleOperation({ params: { operationId } }),
						start: client.godMode.deleteUser({ params: { userId: UserId.make(userId) } }),
					}),
					usersReactivityKey,
				),
			),
		),
	);
	const resetUser = Atom.family((userId: string) =>
		api.runtime.fn(() =>
			Effect.flatMap(api, (client) =>
				Reactivity.mutation(
					runUserLifecycleOperation({
						poll: (operationId) =>
							client.godMode.getUserLifecycleOperation({ params: { operationId } }),
						start: client.godMode.resetUser({ params: { userId: UserId.make(userId) } }),
					}).pipe(
						Effect.flatMap((operation) =>
							operation.resetResult === null
								? Effect.logWarning("completed god-mode reset had no reset result", operation).pipe(
										Effect.andThen(Effect.fail(operation)),
									)
								: Effect.succeed(operation.resetResult),
						),
					),
					usersReactivityKey,
				),
			),
		),
	);
	const resetUserPassword = Atom.family((userId: string) =>
		api.runtime.fn(() =>
			Effect.flatMap(api, (client) =>
				client.godMode.resetUserPassword({ params: { userId: UserId.make(userId) } }),
			),
		),
	);
	const setUserDisabled = Atom.family((userId: string) =>
		api.runtime.fn((disabled: boolean) =>
			Effect.flatMap(api, (client) =>
				Reactivity.mutation(
					client.godMode.setUserDisabled({
						payload: { disabled },
						params: { userId: UserId.make(userId) },
					}),
					usersReactivityKey,
				),
			),
		),
	);
	return {
		resetUser,
		deleteUser,
		setUserDisabled,
		resetUserPassword,
		users: withAppQueryDefaults(
			queryApi.query("godMode", "listUsers", {
				query: { limit: 1000, offset: 0 },
				reactivityKeys: usersReactivityKey,
			}),
		),
	};
};

const sessions = new Map<string, ReturnType<typeof createGodModeSession>>();

const godModeSession = (scope: GodModeScope) => {
	const identity = canonicalGodModeIdentity(scope);
	const key = adminRequestKey(identity.serverUrl, identity.sessionId);
	const existing = sessions.get(key);
	if (existing) {
		return existing;
	}
	const session = createGodModeSession(scope);
	sessions.set(key, session);
	return session;
};

export const clearGodModeSession = (scope: GodModeIdentity) => {
	const identity = canonicalGodModeIdentity(scope);
	sessions.delete(adminRequestKey(identity.serverUrl, identity.sessionId));
};

export const godModeUsersAtom = (scope: GodModeScope) => godModeSession(scope).users;

export const deleteUserAtom = (request: GodModeScope & { readonly userId: string }) =>
	godModeSession(request).deleteUser(request.userId);

export const resetUserAtom = (request: GodModeScope & { readonly userId: string }) =>
	godModeSession(request).resetUser(request.userId);

export const resetUserPasswordAtom = (request: GodModeScope & { readonly userId: string }) =>
	godModeSession(request).resetUserPassword(request.userId);

export const setUserDisabledAtom = (request: GodModeScope & { readonly userId: string }) =>
	godModeSession(request).setUserDisabled(request.userId);
