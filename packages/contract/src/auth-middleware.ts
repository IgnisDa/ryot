import { AuthUnauthorized } from "@ryot-app/instance-contract/admin-auth";
import { Context, Schema } from "effect";
import { HttpApiMiddleware, HttpApiSchema, HttpApiSecurity } from "effect/http-api";

import { type AuthorizationContext as AuthorizationContextValue, WriteAccess } from "./oauth";
import type { UserId } from "./schema/brands";
import { EntitlementRequired } from "./schema/entitlement";
import type { UserPreferences } from "./schema/user-preferences";

const AuthRateLimitReason = Schema.Struct({
	code: Schema.Literal("api-key-rate-limited"),
	retryAfterMs: Schema.NullOr(Schema.Finite.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))),
});

export type CurrentUserValue = {
	readonly id: UserId;
	readonly name: string;
	readonly email: string;
	readonly image: null | string;
	readonly preferences: UserPreferences;
};

export class CurrentUser extends Context.Service<CurrentUser, CurrentUserValue>()(
	"@ryot-app/contract/auth-middleware/CurrentUser",
) {}

export class AuthRateLimited extends Schema.TaggedError<
	AuthRateLimited,
	{ readonly brand: unique symbol }
>()("AuthRateLimited", { reason: AuthRateLimitReason }) {}

export class AuthorizationContext extends Context.Service<
	AuthorizationContext,
	AuthorizationContextValue
>()("@ryot-app/contract/auth-middleware/AuthorizationContext") {}

export class UserInitializing extends Schema.TaggedError<
	UserInitializing,
	{ readonly brand: unique symbol }
>()("UserInitializing", { reason: Schema.Struct({ code: Schema.Literal("user-initializing") }) }) {}

export class DemoOperationProtected extends Schema.TaggedError<
	DemoOperationProtected,
	{ readonly brand: unique symbol }
>()("DemoOperationProtected", {
	reason: Schema.Struct({ code: Schema.Literal("demo-operation-protected") }),
}) {}

export class WriteAccessDenied extends Schema.TaggedError<
	WriteAccessDenied,
	{ readonly brand: unique symbol }
>()("WriteAccessDenied", {
	reason: Schema.Struct({ writeAccess: WriteAccess, code: Schema.Literal("write-access-denied") }),
}) {}

/**
 * @effect-expect-leaking HttpServerRequest
 * @effect-expect-leaking ParsedSearchParams
 * @effect-expect-leaking RouteContext
 */
export class AuthMiddleware extends HttpApiMiddleware.Service<
	AuthMiddleware,
	{ provides: CurrentUser | AuthorizationContext }
>()("AuthMiddleware", {
	security: {
		oauth: HttpApiSecurity.bearer,
		apiKey: HttpApiSecurity.apiKey({ in: "header", key: "x-api-key" }),
	},
	error: [
		AuthUnauthorized.pipe(HttpApiSchema.status(401)),
		DemoOperationProtected.pipe(HttpApiSchema.status(403)),
		EntitlementRequired.pipe(HttpApiSchema.status(402)),
		WriteAccessDenied.pipe(HttpApiSchema.status(403)),
		AuthRateLimited.pipe(HttpApiSchema.status(429)),
		UserInitializing.pipe(HttpApiSchema.status(503)),
	],
}) {}
