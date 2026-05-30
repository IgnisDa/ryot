import { isAPIError } from "better-auth/api";
import { createMiddleware } from "hono/factory";

import { config } from "~/lib/config";

import { ERROR_CODES, errorResponse } from "../openapi/errors";
import { auth, type MaybeAuthType } from "./instance";

export const adminAccessTokenHeader = "Admin-Access-Token" as const;
export const adminAccessTokenSecurityScheme = "admin-access-token" as const;

type ResolveAuthenticatedUserDeps = {
	getSession: (input: {
		headers: Headers;
	}) => Promise<{ user: NonNullable<MaybeAuthType["user"]> } | null>;
};

export const resolveAuthenticatedUser = async (
	request: Request,
	deps: ResolveAuthenticatedUserDeps = {
		getSession: auth.api.getSession,
	},
): Promise<MaybeAuthType["user"]> => {
	const session = await deps.getSession({ headers: request.headers });
	return session ? session.user : null;
};

export const requireAuth = createMiddleware<{ Variables: MaybeAuthType }>(async (c, next) => {
	try {
		const authenticatedUser = await resolveAuthenticatedUser(c.req.raw);
		if (!authenticatedUser) {
			return c.json(errorResponse(ERROR_CODES.UNAUTHENTICATED, "Authentication required"), 401);
		}
		if (authenticatedUser.bannedAt) {
			return c.json(errorResponse(ERROR_CODES.UNAUTHENTICATED, "Authentication required"), 401);
		}
		c.set("user", authenticatedUser);
		return next();
	} catch (error) {
		if (isAPIError(error)) {
			if (error.body?.code === "RATE_LIMITED") {
				const tryAgainIn = error.body.details?.tryAgainIn;
				return c.json(
					errorResponse(ERROR_CODES.RATE_LIMITED, `Please try again in ${tryAgainIn}ms.`),
					429,
				);
			}
		}
		return c.json(errorResponse(ERROR_CODES.UNAUTHENTICATED, "Authentication required"), 401);
	}
});

export const requireAdminAccessToken = createMiddleware(async (c, next) => {
	if (c.req.header(adminAccessTokenHeader)?.trim() !== config.server.adminAccessToken) {
		return c.json(errorResponse(ERROR_CODES.UNAUTHENTICATED, "Authentication required"), 401);
	}

	return next();
});
