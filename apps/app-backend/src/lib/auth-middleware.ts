import { HttpApiMiddleware, HttpApiSecurity } from "@effect/platform";
import { Context, Schema } from "effect";

import { RateLimited, Unauthorized } from "./errors";
import type { UserId } from "./schema/brands";

export type CurrentUserValue = {
	readonly id: UserId;
	readonly name: string;
	readonly email: string;
};

export class CurrentUser extends Context.Tag("CurrentUser")<CurrentUser, CurrentUserValue>() {}

export class AdminAccess extends Context.Tag("AdminAccess")<
	AdminAccess,
	{ readonly authorized: true }
>() {}

/**
 * @effect-expect-leaking HttpServerRequest
 * @effect-expect-leaking ParsedSearchParams
 * @effect-expect-leaking RouteContext
 */
export class AuthMiddleware extends HttpApiMiddleware.Tag<AuthMiddleware>()("AuthMiddleware", {
	provides: CurrentUser,
	failure: Schema.Union(Unauthorized, RateLimited),
	security: {
		apiKey: HttpApiSecurity.apiKey({ in: "header", key: "x-api-key" }),
		cookie: HttpApiSecurity.apiKey({ in: "cookie", key: "better-auth.session_token" }),
	},
}) {}

export class AdminMiddleware extends HttpApiMiddleware.Tag<AdminMiddleware>()("AdminMiddleware", {
	failure: Unauthorized,
	provides: AdminAccess,
	security: { adminToken: HttpApiSecurity.apiKey({ in: "header", key: "Admin-Access-Token" }) },
}) {}
