import { Context, Schema } from "effect";
import { HttpApiMiddleware, HttpApiSchema, HttpApiSecurity } from "effect/http-api";

import type { AuthorizationContext as AuthorizationContextValue } from "./oauth";
import type { AccountGeneration } from "./schema/account-generation";
import type { UserId } from "./schema/brands";
import type { UserPreferences } from "./schema/user-preferences";

const AuthUnauthorizedReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("write-blocked") }),
	Schema.Struct({ code: Schema.Literal("admin-access-required") }),
	Schema.Struct({ code: Schema.Literal("authentication-required") }),
]);

export class AuthUnauthorized extends Schema.TaggedError<AuthUnauthorized>()("AuthUnauthorized", {
	reason: AuthUnauthorizedReason,
}) {}

const AuthRateLimitReason = Schema.Struct({
	code: Schema.Literal("api-key-rate-limited"),
	retryAfterMs: Schema.NullOr(Schema.Finite.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))),
});

export class AuthRateLimited extends Schema.TaggedError<AuthRateLimited>()("AuthRateLimited", {
	reason: AuthRateLimitReason,
}) {}

export class DemoOperationProtected extends Schema.TaggedError<DemoOperationProtected>()(
	"DemoOperationProtected",
	{ reason: Schema.Struct({ code: Schema.Literal("demo-operation-protected") }) },
) {}

export class UserInitializing extends Schema.TaggedError<UserInitializing>()("UserInitializing", {
	reason: Schema.Struct({ code: Schema.Literal("user-initializing") }),
}) {}

export type CurrentUserValue = {
	readonly id: UserId;
	readonly accountGeneration: AccountGeneration;
	readonly name: string;
	readonly email: string;
	readonly image: string | null;
	readonly preferences: UserPreferences;
};

export class CurrentUser extends Context.Service<CurrentUser, CurrentUserValue>()("CurrentUser") {}

export class AuthorizationContext extends Context.Service<
	AuthorizationContext,
	AuthorizationContextValue
>()("AuthorizationContext") {}

export class AdminAccess extends Context.Service<AdminAccess, { readonly authorized: true }>()(
	"AdminAccess",
) {}

/**
 * @effect-expect-leaking HttpServerRequest
 * @effect-expect-leaking ParsedSearchParams
 * @effect-expect-leaking RouteContext
 */
export class AuthMiddleware extends HttpApiMiddleware.Service<
	AuthMiddleware,
	{ provides: AuthorizationContext | CurrentUser }
>()("AuthMiddleware", {
	security: {
		oauth: HttpApiSecurity.bearer,
		apiKey: HttpApiSecurity.apiKey({ in: "header", key: "x-api-key" }),
	},
	error: [
		AuthUnauthorized.pipe(HttpApiSchema.status(401)),
		DemoOperationProtected.pipe(HttpApiSchema.status(403)),
		AuthRateLimited.pipe(HttpApiSchema.status(429)),
		UserInitializing.pipe(HttpApiSchema.status(503)),
	],
}) {}

export class AdminMiddleware extends HttpApiMiddleware.Service<
	AdminMiddleware,
	{ provides: AdminAccess }
>()("AdminMiddleware", {
	error: AuthUnauthorized.pipe(HttpApiSchema.status(401)),
	security: { adminToken: HttpApiSecurity.apiKey({ in: "header", key: "Admin-Access-Token" }) },
}) {}
