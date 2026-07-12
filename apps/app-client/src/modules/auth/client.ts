import { clearAuthStorage, getAuthClient } from "@/modules/auth/storage";
import { useServerUrl } from "@/modules/server/state";
import { clearServerStorage } from "@/modules/server/storage";
import { CLOUD_URL } from "@/modules/server/url";

export { clearAuthStorage };

export async function clearAppStorage() {
	await clearAuthStorage();
	clearServerStorage();
}

export function useAuthClient() {
	return getAuthClient(useServerUrl() ?? CLOUD_URL);
}
