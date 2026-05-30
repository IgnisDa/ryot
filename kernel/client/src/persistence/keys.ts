import { normalizeServerOrigin } from "@/api/origin";
import type { ApiScope } from "@/api/request-key";

export const appStoragePrefix = "ryot:";

export const appStorageKey = (key: string) => `${appStoragePrefix}${key}`;

export const ownedAppStorageKeys = (keys: readonly string[]) =>
	keys.filter((key) => key.startsWith(appStoragePrefix));

export const scopedStorageKey = (prefix: string, scope: ApiScope, ...parts: readonly unknown[]) =>
	`${prefix}:${JSON.stringify([normalizeServerOrigin(scope.serverUrl), scope.userId, ...parts])}`;
