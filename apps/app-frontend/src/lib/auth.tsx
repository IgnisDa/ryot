import { apiKeyClient } from "@better-auth/api-key/client";
import { createAuthClient } from "better-auth/client";
import { tanstackStartCookies } from "better-auth/tanstack-start";

export const authClient = createAuthClient({
	plugins: [apiKeyClient(), tanstackStartCookies()],
});

export type AuthClient = typeof authClient;
export type AuthenticatedUser = typeof authClient.$Infer.Session;
