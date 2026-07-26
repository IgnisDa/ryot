import type { RequestHeaders } from "@ryot/contract/client";

import { serverApiUrl } from "@/modules/server/url";

export interface ContractRequestOptions {
	serverUrl: string;
	authCookie?: string;
	authenticated?: boolean;
	headers?: RequestHeaders;
}

export const contractRequestOptions = (options: ContractRequestOptions) => ({
	baseUrl: serverApiUrl(options.serverUrl),
	headers: {
		...options.headers,
		...(options.authenticated && options.authCookie ? { Cookie: options.authCookie } : {}),
	},
});
