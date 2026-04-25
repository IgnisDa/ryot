import type { ApiScope } from "@/api/request-key";
import { scopedStorageKey } from "@/persistence/keys";

export type WorkspaceStorageScope = ApiScope;

export const workspaceStorageKey = (scope: WorkspaceStorageScope) =>
	scopedStorageKey("workspace", scope);
