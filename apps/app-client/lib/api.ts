import type { paths } from "@ryot/generated/openapi/app-backend";
import createFetchClient from "openapi-fetch";

export function createApiClient(serverUrl: string) {
	return createFetchClient<paths>({
		credentials: "include",
		baseUrl: `${serverUrl}/api`,
	});
}
