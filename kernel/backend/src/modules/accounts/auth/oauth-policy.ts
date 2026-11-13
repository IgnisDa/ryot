import type { OAuthOptions } from "@better-auth/oauth-provider";
import {
	getMcpOAuthResource,
	getOAuthResource,
	OAUTH_ACCESS_TOKEN_TTL_SECONDS,
	OAUTH_API_SCOPE,
	OAUTH_IDENTITY_SCOPES,
	OAUTH_OFFLINE_ACCESS_SCOPE,
	OAUTH_REFRESH_TOKEN_TTL_SECONDS,
	OAUTH_SCOPES,
} from "@ryot-app/contract/oauth";

export const oauthPolicy = {
	firstPartyScopes: OAUTH_SCOPES,
	requiredScopes: [OAUTH_API_SCOPE],
	defaultRegistrationScopes: [OAUTH_API_SCOPE],
	thirdPartyScopes: [...OAUTH_IDENTITY_SCOPES, OAUTH_OFFLINE_ACCESS_SCOPE, OAUTH_API_SCOPE],
} as const;

export const oauthResourcePolicies = (origin: string) => ({
	api: {
		identifier: getOAuthResource(origin),
		accessTokenTtl: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
		allowedScopes: [...oauthPolicy.firstPartyScopes],
		refreshTokenTtl: OAUTH_REFRESH_TOKEN_TTL_SECONDS,
	},
	mcp: {
		identifier: getMcpOAuthResource(origin),
		accessTokenTtl: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
		allowedScopes: [...oauthPolicy.thirdPartyScopes],
		refreshTokenTtl: OAUTH_REFRESH_TOKEN_TTL_SECONDS,
	},
});

export const oauthProviderOptions = (origin: string) =>
	({
		scopes: [...OAUTH_SCOPES],
		resourcePrivileges: () => false,
		enforcePerClientResources: true,
		allowDynamicClientRegistration: true,
		allowUnauthenticatedClientRegistration: true,
		clientRegistrationDefaultApplicationType: "infer",
		clientPrivileges: ({ action }) => action === "create",
		resources: Object.values(oauthResourcePolicies(origin)),
		clientRegistrationAllowedScopes: [...oauthPolicy.thirdPartyScopes],
		clientRegistrationDefaultScopes: [...oauthPolicy.defaultRegistrationScopes],
		clientRegistrationDefaultResources: [oauthResourcePolicies(origin).mcp.identifier],
	}) satisfies Partial<OAuthOptions<readonly string[]>>;
