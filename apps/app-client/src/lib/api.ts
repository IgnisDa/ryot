import type { paths } from "@ryot/generated/openapi/app-backend";
import { fetch } from "expo/fetch";
import createFetchClient from "openapi-fetch";

export function createApiClient(serverUrl: string) {
	return createFetchClient<paths>({
		fetch,
		credentials: "include",
		baseUrl: `${serverUrl}/api`,
	});
}
