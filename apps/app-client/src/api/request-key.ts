import { stableStringify } from "@ryot/ts-utils/json";
import { Atom } from "effect/unstable/reactivity";

import { normalizeServerOrigin } from "@/modules/server/url";

export type ApiScope = { serverUrl: string; userId: string };

export const canonicalApiScope = (scope: ApiScope): ApiScope => ({
	userId: scope.userId,
	serverUrl: normalizeServerOrigin(scope.serverUrl),
});

export const serverRequestKey = (serverUrl: string) =>
	stableStringify([normalizeServerOrigin(serverUrl)]);

export const adminRequestKey = (serverUrl: string, adminToken: string) =>
	stableStringify([normalizeServerOrigin(serverUrl), adminToken]);

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

export const keyedRequestFamily = <Request, Value extends object>(
	requestKey: (request: Request) => string,
	make: (request: Request) => Value,
) => {
	const requests = new Map<string, Request>();
	const family = Atom.family((key: string) => make(requests.get(key)!));

	return (request: Request) => {
		const key = requestKey(request);
		requests.set(key, request);
		try {
			return family(key);
		} finally {
			requests.delete(key);
		}
	};
};
