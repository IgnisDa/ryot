import type { ApiScope } from "@/api/request-key";
import { normalizeServerOrigin } from "@/modules/server/url";

export type WorkspaceStorageScope = ApiScope;

export const workspaceStorageKey = (scope: WorkspaceStorageScope) =>
	`workspace:${JSON.stringify([normalizeServerOrigin(scope.serverUrl), scope.userId])}`;
