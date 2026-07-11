import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";

const OIDC_REDIRECT_TOKEN_PARAM = "token";

// A leading "/" that is not "//" is a same-origin relative path (what the web callback
// sends, since callback.mjs sets Location to the client's callbackURL verbatim, with no
// resolution against baseURL). "//host/path" is protocol-relative and cross-origin in a
// browser, so it must not be treated as same-origin even though it also starts with "/".
export const isSameOriginRelative = (location: string) =>
	location.startsWith("/") && !location.startsWith("//");

// A fragment must stay last: appending after it would fold the token into the fragment,
// where it never reaches the query the client reads.
export const appendOidcRedirectToken = (location: string, token: string) => {
	const fragmentAt = location.indexOf("#");
	const target = fragmentAt === -1 ? location : location.slice(0, fragmentAt);
	const fragment = fragmentAt === -1 ? "" : location.slice(fragmentAt);
	const separator = target.includes("?") ? "&" : "?";
	return `${target}${separator}${OIDC_REDIRECT_TOKEN_PARAM}=${encodeURIComponent(token)}${fragment}`;
};

export const resolveOidcRedirectLocation = (input: {
	readonly location: string;
	readonly token: string | null | undefined;
	readonly isTrustedOrigin: (url: string) => boolean;
}) => {
	if (!input.token) {
		return input.location;
	}
	if (!isSameOriginRelative(input.location) && !input.isTrustedOrigin(input.location)) {
		return input.location;
	}
	return appendOidcRedirectToken(input.location, input.token);
};

const isOAuthCallbackPath = (path: string | undefined) => Boolean(path?.startsWith("/callback/"));

export const oidcTokenRedirect = (): BetterAuthPlugin => ({
	id: "oidc-token-redirect",
	hooks: {
		after: [
			{
				matcher: (context) => isOAuthCallbackPath(context.path),
				handler: createAuthMiddleware((ctx) => {
					const location = ctx.context.responseHeaders?.get("location");
					if (!location) {
						return Promise.resolve();
					}
					const rewritten = resolveOidcRedirectLocation({
						location,
						token: ctx.context.responseHeaders?.get("set-ott"),
						isTrustedOrigin: (url) => ctx.context.isTrustedOrigin(url),
					});
					if (rewritten !== location) {
						ctx.setHeader("location", rewritten);
					}
					return Promise.resolve();
				}),
			},
		],
	},
});
