import type { ServerOrigin } from "#/api/origin";

export type ApiScope = {
	readonly userId: string;
	readonly serverUrl: ServerOrigin;
};

export const apiScopeKey = (scope: ApiScope) => {
	return JSON.stringify([scope.serverUrl, scope.userId]);
};
