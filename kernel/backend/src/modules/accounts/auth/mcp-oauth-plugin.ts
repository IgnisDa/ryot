import {
	getOAuthProviderApi,
	getOAuthProviderState,
	type OAuthOptions,
	verifyOAuthQueryParams,
} from "@better-auth/oauth-provider";
import {
	getMcpOAuthResource,
	getOAuthResource,
	isLoopbackOrigin,
	OAUTH_API_SCOPE,
	OAUTH_AUTHORIZE_PATH,
	OAUTH_CLIENT_IDS,
	OAUTH_MCP_SCOPES,
	OAuthConsentDetails,
	OAuthConsentDetailsRequest,
} from "@ryot-app/contract/oauth";
import type { BetterAuthPlugin } from "better-auth";
import {
	APIError,
	createAuthEndpoint,
	createAuthMiddleware,
	getSessionFromCtx,
} from "better-auth/api";
import { Option, Schema } from "effect";

const invalidRequest = () => new APIError("BAD_REQUEST", { error: "invalid_request" });

export const mcpOAuthOptions = (origin: string) =>
	({
		resourcePrivileges: () => false,
		enforcePerClientResources: true,
		allowDynamicClientRegistration: true,
		allowUnauthenticatedClientRegistration: true,
		clientRegistrationDefaultApplicationType: "infer",
		clientRegistrationDefaultScopes: [OAUTH_API_SCOPE],
		clientPrivileges: ({ action }) => action === "create",
		clientRegistrationAllowedScopes: [...OAUTH_MCP_SCOPES],
		clientRegistrationDefaultResources: [getMcpOAuthResource(origin)],
		resources: [getOAuthResource(origin), getMcpOAuthResource(origin)],
	}) satisfies Partial<OAuthOptions<readonly string[]>>;

const registeredRedirect = (
	redirect: URL,
	registered: readonly string[],
	applicationType?: null | string,
) =>
	registered.some((uri) => {
		if (uri === redirect.href) {
			return true;
		}
		const candidate = new URL(uri);
		if (
			applicationType !== "native" ||
			candidate.protocol !== "http:" ||
			redirect.protocol !== "http:" ||
			!isLoopbackOrigin(candidate.origin) ||
			!isLoopbackOrigin(redirect.origin)
		) {
			return false;
		}
		candidate.port = redirect.port;
		return candidate.href === redirect.href;
	});

export const mcpOAuthPlugin = (origin: string): BetterAuthPlugin => ({
	id: "mcp-oauth",
	hooks: {
		before: [
			{
				matcher: (ctx) =>
					ctx.path === "/oauth2/register" ||
					ctx.path === "/oauth2/authorize" ||
					ctx.path === "/oauth2/create-client",
				// oxlint-disable-next-line effecttsgo/async-function -- Better Auth middleware is Promise-native.
				handler: createAuthMiddleware(async (ctx) => {
					if (ctx.path === "/oauth2/create-client") {
						throw new APIError("FORBIDDEN", { error: "access_denied" });
					}
					if (ctx.path === "/oauth2/register") {
						if (Reflect.get(ctx.body ?? {}, "token_endpoint_auth_method") !== "none") {
							throw new APIError("BAD_REQUEST", {
								error: "invalid_client_metadata",
								error_description:
									"Only public clients may register (token_endpoint_auth_method: none).",
							});
						}
						return undefined;
					}
					const state = await getOAuthProviderState();
					const requestPath = ctx.request
						? new URL(ctx.request.url).pathname.replace(/\/+$/, "")
						: undefined;
					if (state?.query && requestPath !== OAUTH_AUTHORIZE_PATH) {
						return undefined;
					}
					const input: unknown = ctx.method === "POST" ? ctx.body : ctx.query;
					if (!input || typeof input !== "object") {
						return undefined;
					}
					const clientId: unknown = Reflect.get(input, "client_id");
					if (typeof clientId !== "string" || OAUTH_CLIENT_IDS.some((id) => id === clientId)) {
						return undefined;
					}
					const prompt: unknown = Reflect.get(input, "prompt");
					const prompts = new Set(typeof prompt === "string" ? prompt.split(" ") : []);
					prompts.add("consent");
					const parameters = { ...input, prompt: [...prompts].join(" ") };
					return { context: ctx.method === "POST" ? { body: parameters } : { query: parameters } };
				}),
			},
		],
	},
	endpoints: {
		consentDetails: createAuthEndpoint(
			"/oauth2/consent-details",
			{ method: "POST" },
			// oxlint-disable-next-line effecttsgo/async-function -- Better Auth endpoint handlers are Promise-native.
			async (ctx) => {
				const body = Schema.decodeUnknownOption(OAuthConsentDetailsRequest)(ctx.body);
				if (
					Option.isNone(body) ||
					!(await verifyOAuthQueryParams(body.value.oauth_query, ctx.context.secret))
				) {
					throw invalidRequest();
				}
				const query = new URLSearchParams(body.value.oauth_query);
				for (const key of ["client_id", "redirect_uri", "scope"]) {
					if (query.getAll(key).length !== 1) {
						throw invalidRequest();
					}
				}
				const clientId = query.get("client_id");
				const redirectUri = query.get("redirect_uri");
				const scopes = query.get("scope")?.split(/\s+/).filter(Boolean) ?? [];
				if (
					!clientId ||
					!redirectUri ||
					!scopes.includes(OAUTH_API_SCOPE) ||
					scopes.some((scope) => !OAUTH_MCP_SCOPES.some((allowed) => allowed === scope)) ||
					query.get("claims") ||
					query.getAll("resource").some((value) => value !== getMcpOAuthResource(origin))
				) {
					throw invalidRequest();
				}
				const client = await getOAuthProviderApi(ctx, {
					...mcpOAuthOptions(origin),
					loginPage: "/oauth/login",
					consentPage: "/oauth/consent",
				}).getClient(clientId);
				if (!client || client.disabled || client.skipConsent) {
					throw invalidRequest();
				}
				let redirect: URL;
				try {
					redirect = new URL(redirectUri);
				} catch {
					throw invalidRequest();
				}
				if (!registeredRedirect(redirect, client.redirectUris ?? [], client.applicationType)) {
					throw invalidRequest();
				}
				const session = await getSessionFromCtx(ctx, {
					disableRefresh: true,
					disableCookieCache: true,
				});
				if (!session) {
					throw new APIError("UNAUTHORIZED", { error: "login_required" });
				}
				return ctx.json(
					OAuthConsentDetails.make({
						scope: OAUTH_API_SCOPE,
						clientName: client.name ?? client.clientId,
						redirectOrigin: redirect.origin === "null" ? redirect.protocol : redirect.origin,
					}),
				);
			},
		),
	},
});
