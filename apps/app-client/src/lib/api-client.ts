import type { paths } from "@ryot/generated/openapi/app-backend";
import { fetch } from "expo/fetch";
import createFetchClient from "openapi-fetch";
import { useMemo } from "react";

import { useAuthClient, useServerUrl } from "@/lib/atoms";

import { CLOUD_URL } from "./server";

export function createApiClient(serverUrl: string, cookie?: string) {
	return createFetchClient<paths>({
		fetch,
		credentials: "include",
		baseUrl: `${serverUrl}/api`,
		...(cookie && { headers: { Cookie: cookie } }),
	});
}

export function useApiClient() {
	const serverUrl = useServerUrl();
	const authClient = useAuthClient();
	const cookie = authClient.getCookie();
	const baseUrl = serverUrl ?? CLOUD_URL;
	return useMemo(() => createApiClient(baseUrl, cookie), [baseUrl, cookie]);
}
