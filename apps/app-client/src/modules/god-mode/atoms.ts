import type { ContractSuccess } from "@ryot/contract/client";
import { UserId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";
import { Reactivity } from "effect/unstable/reactivity";

import { makeAdminApi, makeAdminQueryApi } from "@/api/admin-api";
import { withAppQueryDefaults } from "@/api/query-client";
import { adminRequestKey, keyedRequestFamily } from "@/api/request-key";
import { normalizeServerOrigin } from "@/modules/server/url";

export type GodModeUser = ContractSuccess<"godMode", "listUsers">["users"][number];

export type GodModeScope = { adminToken: string; serverUrl: string };

const godModeScopeKey = (scope: GodModeScope) => adminRequestKey(scope.serverUrl, scope.adminToken);

const usersReactivityKey = (scope: GodModeScope) => [`god-mode-users:${godModeScopeKey(scope)}`];

const canonicalGodModeScope = (scope: GodModeScope): GodModeScope => ({
	adminToken: scope.adminToken,
	serverUrl: normalizeServerOrigin(scope.serverUrl),
});

export const godModeUsersAtom = keyedRequestFamily(godModeScopeKey, (scope: GodModeScope) => {
	const canonical = canonicalGodModeScope(scope);
	const api = makeAdminQueryApi(canonical.serverUrl, canonical.adminToken);
	return withAppQueryDefaults(
		api.query("godMode", "listUsers", {
			query: { limit: 100, offset: 0 },
			reactivityKeys: usersReactivityKey(canonical),
		}),
	);
});

type GodModeUserRequest = GodModeScope & { userId: string };

const godModeUserRequestKey = (request: GodModeUserRequest) =>
	JSON.stringify([godModeScopeKey(request), request.userId]);

export const resetUserPasswordAtom = keyedRequestFamily(
	godModeUserRequestKey,
	(request: GodModeUserRequest) => {
		const canonical = canonicalGodModeScope(request);
		const api = makeAdminApi(canonical.serverUrl, canonical.adminToken);
		return api.runtime.fn(() =>
			Effect.flatMap(api, (client) =>
				client.godMode.resetUserPassword({ params: { userId: UserId.make(request.userId) } }),
			),
		);
	},
);

export const setUserDisabledAtom = keyedRequestFamily(
	godModeUserRequestKey,
	(request: GodModeUserRequest) => {
		const canonical = canonicalGodModeScope(request);
		const api = makeAdminApi(canonical.serverUrl, canonical.adminToken);
		return api.runtime.fn((disabled: boolean) =>
			Effect.flatMap(api, (client) =>
				Reactivity.mutation(
					client.godMode.setUserDisabled({
						payload: { disabled },
						params: { userId: UserId.make(request.userId) },
					}),
					usersReactivityKey(canonical),
				),
			),
		);
	},
);
