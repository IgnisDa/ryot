import type { paths } from "@ryot/generated/openapi/app-backend";
import createFetchClient from "openapi-fetch";
import { useMemo } from "react";

import { useAuthClient, useServerUrl } from "@/lib/atoms";

import { CLOUD_URL } from "./server";

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
		[baseUrl, cookie],
	);
}
