import { runContract } from "@ryot/contract/client";

import { serverApiUrl, type ServerOrigin } from "./origin";

export const checkServerHealth = (origin: ServerOrigin) =>
	runContract((client) => client.system.health(), { baseUrl: serverApiUrl(origin) });

export const fetchSystemConfig = (origin: ServerOrigin) =>
	runContract((client) => client.system.config(), { baseUrl: serverApiUrl(origin) });
