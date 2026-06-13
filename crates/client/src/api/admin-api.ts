import { AppContract } from "@ryot-app/contract/contract";
import { Layer } from "effect";
import { AtomHttpApi } from "effect/unstable/reactivity";

import { retryQueryResponse, withAppQueryDefaults } from "@/api/client";
import { normalizeServerOrigin } from "@/api/origin";
import { adminRequestKey } from "@/api/request-key";
import { adminTokenRequestLayer, transportEnvironmentLive } from "@/api/transport";

export type AdminSession = { readonly serverUrl: string; readonly sessionId: string };

export const canonicalAdminSession = (session: AdminSession): AdminSession => ({
	sessionId: session.sessionId,
	serverUrl: normalizeServerOrigin(session.serverUrl),
});

const adminSessionKey = (session: AdminSession) =>
	adminRequestKey(session.serverUrl, session.sessionId);

const adminTokens = new Map<string, string>();

const createAdminClient = (session: AdminSession) => {
	const key = adminSessionKey(session);
	const httpClient = adminTokenRequestLayer(session.serverUrl, () => adminTokens.get(key)).pipe(
		Layer.provide(transportEnvironmentLive),
	);
	const api = AtomHttpApi.Service()("AdminApi", { api: AppContract, httpClient });
	const queryApi = AtomHttpApi.Service()("AdminQueryApi", {
		httpClient,
		api: AppContract,
		transformResponse: retryQueryResponse,
	});
	const query: typeof queryApi.query = new Proxy(queryApi.query, {
		apply: (target, thisArg, argumentsList) =>
			withAppQueryDefaults(Reflect.apply(target, thisArg, argumentsList)),
	});
	return { query, runtime: api.runtime, mutation: api.mutation, request: api };
};

const adminClients = new Map<string, ReturnType<typeof createAdminClient>>();

export const registerAdminSession = (session: AdminSession & { readonly adminToken: string }) => {
	const canonical = canonicalAdminSession(session);
	adminTokens.set(adminSessionKey(canonical), session.adminToken);
};

export const clearAdminSession = (session: AdminSession) => {
	const key = adminSessionKey(canonicalAdminSession(session));
	adminTokens.delete(key);
	adminClients.delete(key);
};

export const adminClient = (input: AdminSession) => {
	const session = canonicalAdminSession(input);
	const key = adminSessionKey(session);
	const existing = adminClients.get(key);
	if (existing) {
		return existing;
	}
	const client = createAdminClient(session);
	adminClients.set(key, client);
	return client;
};
