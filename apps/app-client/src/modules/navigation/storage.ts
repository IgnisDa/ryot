import { normalizeServerOrigin } from "@/modules/server/url";

export type WorkspaceStorageScope = { userId: string; serverUrl: string };

export const workspaceStorageKey = (scope: WorkspaceStorageScope) =>
	`workspace:${JSON.stringify([normalizeServerOrigin(scope.serverUrl), scope.userId])}`;
