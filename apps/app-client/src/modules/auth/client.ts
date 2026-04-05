import { getAuthClient } from "@/modules/auth/storage";
import { useServerUrl } from "@/modules/server/state";
import { CLOUD_URL } from "@/modules/server/url";

export { clearAuthStorage } from "@/modules/auth/storage";

export function useAuthClient() {
	return getAuthClient(useServerUrl() ?? CLOUD_URL);
}
