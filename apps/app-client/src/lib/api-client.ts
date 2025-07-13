import type { paths } from "@ryot/generated/openapi/app-backend";
import createFetchClient from "openapi-fetch";
import { useMemo } from "react";
import { CLOUD_URL, useAuthClient, useServerUrl } from "@/lib/atoms";

export function useApiClient() {
	const serverUrl = useServerUrl();
	const authClient = useAuthClient();
	const cookie = authClient.getCookie();
	const baseUrl = serverUrl ?? CLOUD_URL;
	return useMemo(
		() =>
			createFetchClient<paths>({
				baseUrl: `${baseUrl}/api`,
				headers: { Cookie: cookie },
			}),
		[baseUrl],
	);
}
