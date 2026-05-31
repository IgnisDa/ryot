import { normalizeServerOrigin } from "./origin";

export type ApiScope = {
	readonly userId: string;
	readonly serverUrl: string;
};

export const canonicalApiScope = (scope: ApiScope): ApiScope => ({
	userId: scope.userId,
	serverUrl: normalizeServerOrigin(scope.serverUrl),
});

export const apiScopeKey = (scope: ApiScope) => {
	const canonical = canonicalApiScope(scope);
	return JSON.stringify([canonical.serverUrl, canonical.userId]);
};
