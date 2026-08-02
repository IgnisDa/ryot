import { clearAuthStorage, getAuthClient } from "@/modules/auth/storage";
import { useServerUrl } from "@/modules/server/state";
import { CLOUD_URL } from "@/modules/server/url";
import { clearAppPersistence } from "@/persistence/storage";

export { clearAuthStorage };

export async function clearAppStorage() {
	clearAppPersistence();
	await clearAuthStorage();
}

export function useAuthClient() {
	return getAuthClient(useServerUrl() ?? CLOUD_URL);
}
