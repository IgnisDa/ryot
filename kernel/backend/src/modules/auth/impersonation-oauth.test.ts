import { assert, expect, it } from "@effect/vitest";
import { OAUTH_IMPERSONATION_WEB_CLIENT_ID, OAUTH_WEB_CLIENT_ID } from "@ryot-app/contract/oauth";
import { APIError } from "better-auth/api";
import { getTestInstance } from "better-auth/test";
import { Cause, Effect, Exit, Ref, Result } from "effect";

import { impersonationOAuthExtension } from "./impersonation-oauth";

const user = {
	image: null,
	id: "user-1",
	name: "User",
	emailVerified: true,
	email: "user@example.com",
	createdAt: new Date("2026-09-01T00:00:00.000Z"),
	updatedAt: new Date("2026-09-01T00:00:00.000Z"),
};

type TestAuthContext = Awaited<Awaited<ReturnType<typeof getTestInstance>>["auth"]["$context"]>;

const makeEndpointContext = (authContext: TestAuthContext) => ({
	body: {},
	query: {},
	params: {},
	method: "GET",
	setCookie: () => "",
	context: authContext,
	getCookie: () => null,
	getHeader: () => null,
	headers: new Headers(),
	path: "/oauth2/userinfo",
	setStatus: () => undefined,
	setHeader: () => undefined,
	responseHeaders: new Headers(),
	setSignedCookie: () => Promise.resolve(""),
	getSignedCookie: () => Promise.resolve(null),
	request: new Request("http://localhost/oauth2/userinfo"),
	error: () => APIError.from("BAD_REQUEST", { code: "unused", message: "unused" }),
	json: <R extends Record<string, unknown> | null>(value: R) => Promise.resolve(value),
	redirect: (url: string) => APIError.from("BAD_REQUEST", { message: url, code: "redirect" }),
});

it.effect("adds active session metadata only to impersonation OAuth claims", () =>
	Effect.gen(function* () {
		const active = yield* Ref.make<{ readonly expiresAt: number } | null>({
			expiresAt: 1_800_000_000_000,
		});
		const reads: Array<readonly [string, string]> = [];
		const extension = impersonationOAuthExtension({
			getActive: (sessionId, userId) => {
				reads.push([sessionId, userId]);
				return Ref.get(active);
			},
		});
		const instance = yield* Effect.promise(() => getTestInstance());
		const authContext = yield* Effect.promise(() => instance.auth.$context);
		const context = makeEndpointContext(authContext);
		const accessToken = extension.claims?.accessToken;
		const userInfo = extension.claims?.userInfo;
		assert(accessToken !== undefined);
		assert(userInfo !== undefined);

		expect(
			yield* Effect.promise(() =>
				Promise.resolve(
					accessToken({
						user,
						scopes: [],
						ctx: context,
						client: { clientId: OAUTH_WEB_CLIENT_ID },
						opts: { loginPage: "/login", consentPage: "/consent" },
					}),
				),
			),
		).toEqual({});
		expect(
			yield* Effect.promise(() =>
				Promise.resolve(
					accessToken({
						user,
						scopes: [],
						ctx: context,
						sessionId: "session-1",
						opts: { loginPage: "/login", consentPage: "/consent" },
						client: { clientId: OAUTH_IMPERSONATION_WEB_CLIENT_ID },
					}),
				),
			),
		).toEqual({ impersonation: { expiresAt: 1_800_000_000_000 } });

		expect(
			yield* Effect.promise(() =>
				Promise.resolve(
					userInfo({
						user,
						scopes: [],
						ctx: context,
						requestedClaims: [],
						opts: { loginPage: "/login", consentPage: "/consent" },
						jwt: { sub: "user-1", sid: "session-1", azp: OAUTH_IMPERSONATION_WEB_CLIENT_ID },
					}),
				),
			),
		).toEqual({ impersonation: { expiresAt: 1_800_000_000_000 } });
		expect(reads).toEqual([
			["session-1", "user-1"],
			["session-1", "user-1"],
		]);
	}),
);

it.effect("rejects inactive impersonation grants and user-info tokens", () =>
	Effect.gen(function* () {
		const active = yield* Ref.make<{ readonly expiresAt: number } | null>(null);
		const extension = impersonationOAuthExtension({ getActive: () => Ref.get(active) });
		const instance = yield* Effect.promise(() => getTestInstance());
		const authContext = yield* Effect.promise(() => instance.auth.$context);
		const context = makeEndpointContext(authContext);
		const accessToken = extension.claims?.accessToken;
		const userInfo = extension.claims?.userInfo;
		assert(accessToken !== undefined);
		assert(userInfo !== undefined);

		const accessFailure = yield* Effect.exit(
			Effect.promise(() =>
				Promise.resolve(
					accessToken({
						user,
						scopes: [],
						ctx: context,
						sessionId: "session-1",
						opts: { loginPage: "/login", consentPage: "/consent" },
						client: { clientId: OAUTH_IMPERSONATION_WEB_CLIENT_ID },
					}),
				),
			),
		);
		assert(Exit.isFailure(accessFailure));
		const accessDefect = Cause.findDefect(accessFailure.cause);
		assert(Result.isSuccess(accessDefect));
		expect(accessDefect.success).toBeInstanceOf(APIError);
		expect(accessDefect.success).toHaveProperty("status", "BAD_REQUEST");

		const userInfoFailure = yield* Effect.exit(
			Effect.promise(() =>
				Promise.resolve(
					userInfo({
						user,
						scopes: [],
						ctx: context,
						requestedClaims: [],
						opts: { loginPage: "/login", consentPage: "/consent" },
						jwt: { sub: "user-1", sid: "session-1", azp: OAUTH_IMPERSONATION_WEB_CLIENT_ID },
					}),
				),
			),
		);
		assert(Exit.isFailure(userInfoFailure));
		const userInfoDefect = Cause.findDefect(userInfoFailure.cause);
		assert(Result.isSuccess(userInfoDefect));
		expect(userInfoDefect.success).toBeInstanceOf(APIError);
		expect(userInfoDefect.success).toHaveProperty("status", "UNAUTHORIZED");
	}),
);
