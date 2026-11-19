import { Context, Schema } from "effect";
import { HttpApiMiddleware, HttpApiSchema, HttpApiSecurity } from "effect/http-api";

const AuthUnauthorizedReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("write-blocked") }),
	Schema.Struct({ code: Schema.Literal("admin-access-required") }),
	Schema.Struct({ code: Schema.Literal("authentication-required") }),
]);

export class AdminAccess extends Context.Service<AdminAccess, { readonly authorized: true }>()(
	"@ryot-app/instance-contract/admin-auth/AdminAccess",
) {}

export class AuthUnauthorized extends Schema.TaggedError<
	AuthUnauthorized,
	{ readonly brand: unique symbol }
>()("AuthUnauthorized", { reason: AuthUnauthorizedReason }) {}

export const ADMIN_ACCESS_TOKEN_HEADER = "Admin-Access-Token";

export class AdminMiddleware extends HttpApiMiddleware.Service<
	AdminMiddleware,
	{ provides: AdminAccess }
>()("AdminMiddleware", {
	error: AuthUnauthorized.pipe(HttpApiSchema.status(401)),
	security: {
		adminToken: HttpApiSecurity.apiKey({ in: "header", key: ADMIN_ACCESS_TOKEN_HEADER }),
	},
}) {}
