import { isObjectRecord } from "@ryot/ts-utils/predicates";
import { Context } from "effect";
import { HttpApiMiddleware, HttpApiSchema, HttpApiSecurity } from "effect/unstable/httpapi";

import { RateLimited, Unauthorized } from "./errors";
import type { UserId } from "./schema/brands";

export type CachedUserPreferences = {
	readonly isNsfw: boolean;
	readonly language: string | null;
	readonly disableIntegrations: boolean;
};

export const defaultUserPreferences: CachedUserPreferences = {
	isNsfw: false,
	language: null,
	disableIntegrations: false,
};

// Coerces an untrusted stored preferences blob (jsonb / session copy) into the typed shape, applying
// defaults for missing or malformed fields.
export const normalizeUserPreferences = (value: unknown): CachedUserPreferences => {
	const record = isObjectRecord(value) ? value : {};
	return {
		isNsfw: record["isNsfw"] === true,
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
	readonly preferences: CachedUserPreferences;
};

export class CurrentUser extends Context.Service<CurrentUser, CurrentUserValue>()("CurrentUser") {}

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
	{ provides: CurrentUser }
>()("AuthMiddleware", {
	error: [
		Unauthorized.pipe(HttpApiSchema.status(401)),
		RateLimited.pipe(HttpApiSchema.status(429)),
	],
	security: {
		apiKey: HttpApiSecurity.apiKey({ in: "header", key: "x-api-key" }),
		cookie: HttpApiSecurity.apiKey({ in: "cookie", key: "better-auth.session_token" }),
	},
}) {}

export class AdminMiddleware extends HttpApiMiddleware.Service<
	AdminMiddleware,
	{ provides: AdminAccess }
>()("AdminMiddleware", {
	error: Unauthorized.pipe(HttpApiSchema.status(401)),
	security: { adminToken: HttpApiSecurity.apiKey({ in: "header", key: "Admin-Access-Token" }) },
}) {}
