import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { parseSetCookieHeader, setRequestCookie } from "better-auth/cookies/utils";

export const TWO_FACTOR_COOKIE_NAME = "two_factor";
export const TWO_FACTOR_TOKEN_HEADER = "x-two-factor-token";
export const SET_TWO_FACTOR_TOKEN_HEADER = "set-two-factor-token";

const TWO_FACTOR_PATH_PREFIX = "/two-factor/";

export const isTwoFactorVerifyPath = (path: string | undefined) =>
	Boolean(path?.startsWith(TWO_FACTOR_PATH_PREFIX));

export const issuedChallenge = (setCookie: string | null | undefined, cookieName: string) => {
	if (!setCookie) {
		return undefined;
	}
	const challenge = parseSetCookieHeader(setCookie).get(cookieName);
	return !challenge?.value || challenge["max-age"] === 0 ? undefined : challenge.value;
};

export const withExposedHeader = (exposed: string | null | undefined, name: string) => {
	const names = new Set(
		(exposed ?? "")
			.split(",")
			.map((entry) => entry.trim())
			.filter(Boolean),
	);
	names.add(name);
	return [...names].join(", ");
};

const cookieName = (context: { createAuthCookie: (name: string) => { name: string } }) =>
	context.createAuthCookie(TWO_FACTOR_COOKIE_NAME).name;

export const twoFactorBearerBridge = (): BetterAuthPlugin => ({
	id: "two-factor-bearer-bridge",
	hooks: {
		before: [
			{
				matcher: (context) => isTwoFactorVerifyPath(context.path),
				handler: createAuthMiddleware((ctx) => {
					const token =
						ctx.request?.headers.get(TWO_FACTOR_TOKEN_HEADER) ??
						ctx.headers?.get(TWO_FACTOR_TOKEN_HEADER);
					if (!token) {
						return Promise.resolve(undefined);
					}
					const existing = ctx.request?.headers ?? ctx.headers;
					const headers = new Headers(
						existing ? Object.fromEntries(existing.entries()) : undefined,
					);
					setRequestCookie(headers, cookieName(ctx.context), token);
					return Promise.resolve({ context: { headers } });
				}),
			},
		],
		after: [
			{
				matcher: () => true,
				handler: createAuthMiddleware((ctx) => {
					const challenge = issuedChallenge(
						ctx.context.responseHeaders?.get("set-cookie"),
						cookieName(ctx.context),
					);
					if (challenge) {
						ctx.setHeader(SET_TWO_FACTOR_TOKEN_HEADER, challenge);
						ctx.setHeader(
							"Access-Control-Expose-Headers",
							withExposedHeader(
								ctx.context.responseHeaders?.get("access-control-expose-headers"),
								SET_TWO_FACTOR_TOKEN_HEADER,
							),
						);
					}
					return Promise.resolve();
				}),
			},
		],
	},
});
