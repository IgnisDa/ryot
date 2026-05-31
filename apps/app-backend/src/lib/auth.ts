import { HttpApiMiddleware, HttpApiSecurity } from "@effect/platform";
import { Context, Effect, Layer, Redacted } from "effect";

import { Unauthorized, unauthorized } from "./errors";

export type CurrentUserValue = {
	readonly id: string;
	readonly name: string;
	readonly email: string;
};

export class CurrentUser extends Context.Tag("CurrentUser")<CurrentUser, CurrentUserValue>() {}

export class AdminAccess extends Context.Tag("AdminAccess")<
	AdminAccess,
	{ readonly authorized: true }
>() {}

export class AuthMiddleware extends HttpApiMiddleware.Tag<AuthMiddleware>()("AuthMiddleware", {
	failure: Unauthorized,
	provides: CurrentUser,
	security: {
		cookie: HttpApiSecurity.apiKey({ in: "cookie", key: "better-auth.session_token" }),
		apiKey: HttpApiSecurity.apiKey({ in: "header", key: "x-api-key" }),
	},
}) {}

export class AdminMiddleware extends HttpApiMiddleware.Tag<AdminMiddleware>()("AdminMiddleware", {
	failure: Unauthorized,
	provides: AdminAccess,
	security: {
		adminToken: HttpApiSecurity.apiKey({ in: "header", key: "x-admin-access-token" }),
	},
}) {}

// Stub implementations - replaced in Task 08 (Auth Middleware And Security Schemes)
const stubUser: CurrentUserValue = {
	id: "stub-user",
	name: "Stub User",
	email: "stub@example.com",
};

export const AuthMiddlewareLive = Layer.succeed(AuthMiddleware, {
	cookie: (token) =>
		Redacted.value(token) === "" ? Effect.fail(unauthorized()) : Effect.succeed(stubUser),
	apiKey: (token) =>
		Redacted.value(token) === "" ? Effect.fail(unauthorized()) : Effect.succeed(stubUser),
});

export const AdminMiddlewareLive = Layer.succeed(AdminMiddleware, {
	adminToken: (token) =>
		Redacted.value(token) === ""
			? Effect.fail(unauthorized())
			: Effect.succeed({ authorized: true as const }),
});
