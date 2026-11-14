import type { ContractSession } from "./contract-client";

export const adminAccessTokenHeaders = (token: string) => ({ "Admin-Access-Token": token });

export const adminHeaders = (client: ContractSession) =>
	adminAccessTokenHeaders(client.target.adminAccessToken);
