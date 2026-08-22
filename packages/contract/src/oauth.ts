import { Schema } from "effect";

import { strictStruct } from "./schema/utils";

export const OAUTH_WEB_CLIENT_ID = "ryot-web";
export const OAUTH_NATIVE_CLIENT_ID = "ryot-native";
export const OAUTH_DEMO_WEB_CLIENT_ID = "ryot-demo-web";
export const OAUTH_NATIVE_APPLICATION_IDS = ["io.ryot.app", "io.ryot.app.dev"] as const;
export const OAUTH_WEB_CLIENT_IDS = [OAUTH_WEB_CLIENT_ID, OAUTH_DEMO_WEB_CLIENT_ID] as const;
export const OAUTH_CLIENT_IDS = [...OAUTH_WEB_CLIENT_IDS, OAUTH_NATIVE_CLIENT_ID] as const;

export const AccessClass = Schema.Literals(["standard", "demo"]);
export type AccessClass = typeof AccessClass.Type;

export const WebOAuthClientId = Schema.Literals(OAUTH_WEB_CLIENT_IDS);
export type WebOAuthClientId = typeof WebOAuthClientId.Type;

export const NativeOAuthClientId = Schema.Literal(OAUTH_NATIVE_CLIENT_ID);
export type NativeOAuthClientId = typeof NativeOAuthClientId.Type;

export const OAuthClientId = Schema.Literals(OAUTH_CLIENT_IDS);
export type OAuthClientId = typeof OAuthClientId.Type;

export const NativeOAuthApplicationId = Schema.Literals(OAUTH_NATIVE_APPLICATION_IDS);
export type NativeOAuthApplicationId = typeof NativeOAuthApplicationId.Type;

export const OAUTH_API_SCOPE = "ryot:api";
export const OAUTH_SCOPES = [
	"openid",
	"profile",
	"email",
	"offline_access",
	OAUTH_API_SCOPE,
] as const;
export const OAUTH_SCOPE = OAUTH_SCOPES.join(" ");

export const OAUTH_PKCE_METHOD = "S256";
export const OAUTH_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const OAUTH_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export const OAUTH_LOGIN_PATH = "/oauth/login";
export const OAUTH_CALLBACK_PATH = "/auth/callback";
export const OAUTH_LOGOUT_CALLBACK_PATH = "/auth/logout/callback";

export const OAUTH_ISSUER_PATH = "/api/auth";
export const OAUTH_TOKEN_PATH = "/api/auth/oauth2/token";
export const OAUTH_REVOKE_PATH = "/api/auth/oauth2/revoke";
export const OAUTH_USERINFO_PATH = "/api/auth/oauth2/userinfo";
export const OAUTH_AUTHORIZE_PATH = "/api/auth/oauth2/authorize";
export const OAUTH_END_SESSION_PATH = "/api/auth/oauth2/end-session";

export const getNativeOAuthCallbackUri = (applicationId: NativeOAuthApplicationId) =>
	`${applicationId}:${OAUTH_CALLBACK_PATH}`;
export const getNativeOAuthLogoutCallbackUri = (applicationId: NativeOAuthApplicationId) =>
	`${applicationId}:${OAUTH_LOGOUT_CALLBACK_PATH}`;
export const OAUTH_NATIVE_CALLBACK_URIS =
	OAUTH_NATIVE_APPLICATION_IDS.map(getNativeOAuthCallbackUri);
export const OAUTH_NATIVE_LOGOUT_CALLBACK_URIS = OAUTH_NATIVE_APPLICATION_IDS.map(
	getNativeOAuthLogoutCallbackUri,
);

export const isLoopbackOrigin = (origin: string) => {
	const { hostname } = new URL(origin);
	return (
		hostname === "[::1]" ||
		hostname === "localhost" ||
		hostname.endsWith(".localhost") ||
		/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
	);
};

const fromOrigin = (origin: string, path: string) => new URL(path, origin).toString();

export const getOAuthResource = (origin: string) => fromOrigin(origin, "/api");
export const getOAuthIssuer = (origin: string) => fromOrigin(origin, OAUTH_ISSUER_PATH);
export const getOAuthEndpoint = (origin: string, path: string) => fromOrigin(origin, path);
export const getWebOAuthCallbackUri = (origin: string) => fromOrigin(origin, OAUTH_CALLBACK_PATH);
export const getWebOAuthLogoutCallbackUri = (origin: string) =>
	fromOrigin(origin, OAUTH_LOGOUT_CALLBACK_PATH);
export const getWebOAuthRedirectUris = (origin: string) => [getWebOAuthCallbackUri(origin)];
export const getWebOAuthLogoutRedirectUris = (origin: string) => [
	getWebOAuthLogoutCallbackUri(origin),
];

export const OAuthTokenResponse = strictStruct({
	scope: Schema.String,
	token_type: Schema.String,
	expires_at: Schema.Number,
	expires_in: Schema.Number,
	access_token: Schema.String,
	id_token: Schema.optional(Schema.String),
	refresh_token: Schema.optional(Schema.String),
});
export type OAuthTokenResponse = typeof OAuthTokenResponse.Type;

export const OAuthUserInfoResponse = strictStruct({
	sub: Schema.String,
	name: Schema.optional(Schema.NullOr(Schema.String)),
	email: Schema.optional(Schema.NullOr(Schema.String)),
	picture: Schema.optional(Schema.NullOr(Schema.String)),
	given_name: Schema.optional(Schema.NullOr(Schema.String)),
	family_name: Schema.optional(Schema.NullOr(Schema.String)),
	email_verified: Schema.optional(Schema.NullOr(Schema.Boolean)),
});
export type OAuthUserInfoResponse = typeof OAuthUserInfoResponse.Type;

export const PendingAuthorization = strictStruct({
	state: Schema.String,
	nonce: Schema.String,
	clientId: OAuthClientId,
	createdAt: Schema.Number,
	redirectUri: Schema.String,
	destination: Schema.String,
	serverOrigin: Schema.String,
	codeVerifier: Schema.String,
});
export type PendingAuthorization = typeof PendingAuthorization.Type;

export const StoredTokenSet = strictStruct({
	scope: Schema.String,
	idToken: Schema.String,
	clientId: OAuthClientId,
	tokenType: Schema.String,
	accessToken: Schema.String,
	refreshToken: Schema.String,
	accessTokenExpiresAt: Schema.Number,
});
export type StoredTokenSet = typeof StoredTokenSet.Type;

export const OAuthCallbackQuery = strictStruct({
	code: Schema.optional(Schema.String),
	error: Schema.optional(Schema.String),
	state: Schema.optional(Schema.String),
	error_description: Schema.optional(Schema.String),
});
export type OAuthCallbackQuery = typeof OAuthCallbackQuery.Type;

const OAuthCredential = strictStruct({ clientId: Schema.String, kind: Schema.Literal("oauth") });
const ApiKeyCredential = strictStruct({ keyId: Schema.String, kind: Schema.Literal("api-key") });

export const AuthorizationContext = strictStruct({
	userId: Schema.String,
	accessClass: AccessClass,
	credential: Schema.Union([OAuthCredential, ApiKeyCredential]),
});
export type AuthorizationContext = typeof AuthorizationContext.Type;
