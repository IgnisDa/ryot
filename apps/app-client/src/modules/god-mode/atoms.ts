import type { ContractSuccess } from "@ryot/contract/client";
import { UserId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";
import { Atom, Reactivity } from "effect/unstable/reactivity";

import { makeAdminApi, makeAdminQueryApi } from "@/api/admin-api";
import { withAppQueryDefaults } from "@/api/client";
import { normalizeServerOrigin } from "@/api/origin";
import { adminRequestKey } from "@/api/request-key";

export type GodModeUser = ContractSuccess<"godMode", "listUsers">["users"][number];

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
		resetUserPassword,
		setUserDisabled,
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

export const resetUserPasswordAtom = (request: GodModeScope & { readonly userId: string }) =>
	godModeSession(request).resetUserPassword(request.userId);

export const setUserDisabledAtom = (request: GodModeScope & { readonly userId: string }) =>
	godModeSession(request).setUserDisabled(request.userId);
