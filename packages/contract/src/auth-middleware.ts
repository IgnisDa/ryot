import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Context, Schema } from "effect";
import { HttpApiMiddleware, HttpApiSchema, HttpApiSecurity } from "effect/unstable/httpapi";

import type { AuthorizationContext as AuthorizationContextValue } from "./oauth";
import type { UserId } from "./schema/brands";

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
	retryAfterMs: Schema.NullOr(Schema.Number.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))),
});

export class AuthRateLimited extends Schema.TaggedError<AuthRateLimited>()("AuthRateLimited", {
	reason: AuthRateLimitReason,
}) {}

export class DemoOperationProtected extends Schema.TaggedError<DemoOperationProtected>()(
	"DemoOperationProtected",
	{ reason: Schema.Struct({ code: Schema.Literal("demo-operation-protected") }) },
) {}

export type CachedUserPreferences = {
	readonly allowNsfw: boolean;
	readonly language: string | null;
	readonly disableIntegrations: boolean;
};

export const defaultUserPreferences: CachedUserPreferences = {
	language: null,
	allowNsfw: false,
	disableIntegrations: false,
};

// Coerces an untrusted stored preferences blob (jsonb / session copy) into the typed shape, applying
// defaults for missing or malformed fields.
export const normalizeUserPreferences = (value: unknown): CachedUserPreferences => {
	const record = isObjectRecord(value) ? value : {};
	return {
		allowNsfw: record["allowNsfw"] === true,
		disableIntegrations: record["disableIntegrations"] === true,
		language:
			typeof record["language"] === "string" && record["language"].length > 0
				? record["language"]
				: null,
	};
};

export type CurrentUserValue = {
	readonly id: UserId;
	readonly name: string;
	readonly email: string;
	readonly image: string | null;
	readonly preferences: CachedUserPreferences;
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
	],
}) {}

export class AdminMiddleware extends HttpApiMiddleware.Service<
	AdminMiddleware,
	{ provides: AdminAccess }
>()("AdminMiddleware", {
	error: AuthUnauthorized.pipe(HttpApiSchema.status(401)),
	security: { adminToken: HttpApiSecurity.apiKey({ in: "header", key: "Admin-Access-Token" }) },
}) {}
