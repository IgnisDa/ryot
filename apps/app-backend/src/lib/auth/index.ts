export type { AuthType, MaybeAuthType } from "./instance";
export { auth, OIDC_PROVIDER_ID } from "./instance";
export {
	adminAccessTokenHeader,
	adminAccessTokenSecurityScheme,
	requireAdminAccessToken,
} from "./middleware";
export { createAdminRoute, createAuthRoute } from "./hono";
