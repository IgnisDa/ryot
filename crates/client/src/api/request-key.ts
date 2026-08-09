import { stableStringify } from "@ryot-app/ts-utils/json";

import { normalizeServerOrigin } from "@/api/origin";

export type ApiScope = { serverUrl: string; userId: string };

export const canonicalApiScope = (scope: ApiScope): ApiScope => ({
	userId: scope.userId,
	serverUrl: normalizeServerOrigin(scope.serverUrl),
});

export const serverRequestKey = (serverUrl: string) =>
	stableStringify([normalizeServerOrigin(serverUrl)]);

export const adminRequestKey = (serverUrl: string, sessionId: string) =>
	stableStringify([normalizeServerOrigin(serverUrl), sessionId]);

export const apiScopeKey = (scope: ApiScope) => {
	const canonical = canonicalApiScope(scope);
	return stableStringify([canonical.serverUrl, canonical.userId]);
};

export const scopedRequestKey = (scope: ApiScope, ...parts: readonly unknown[]) => {
	const canonical = canonicalApiScope(scope);
	return stableStringify([canonical.serverUrl, canonical.userId, ...parts]);
};

export const scopedReactivityKey = (name: string, scope: ApiScope) => [
	scopedRequestKey(scope, name),
];
