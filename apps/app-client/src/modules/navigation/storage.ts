import { normalizeServerOrigin } from "@/api/origin";
import type { ApiScope } from "@/api/request-key";

export type WorkspaceStorageScope = ApiScope;

export const workspaceStorageKey = (scope: WorkspaceStorageScope) =>
	`workspace:${JSON.stringify([normalizeServerOrigin(scope.serverUrl), scope.userId])}`;
