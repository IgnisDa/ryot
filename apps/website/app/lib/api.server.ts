import type { paths } from "@ryot/generated/openapi/app-backend";
import createFetchClient from "openapi-fetch";

import { getServerVariables } from "./config.server";

export const getAppBackendApiClient = () => {
	const serverVariables = getServerVariables();

	return createFetchClient<paths>({
		baseUrl: `${serverVariables.RYOT_BASE_URL}/api`,
		headers: { "Admin-Access-Token": serverVariables.SERVER_ADMIN_ACCESS_TOKEN },
	});
};
