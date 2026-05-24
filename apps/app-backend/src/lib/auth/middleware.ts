import { isAPIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";

import { getInternalRequestAuth } from "~/app/internal-auth";
import { config } from "~/lib/config";
import { db } from "~/lib/db";
import { user } from "~/lib/db/schema";

import { ERROR_CODES, errorResponse } from "../openapi/errors";
import { auth, type MaybeAuthType } from "./instance";

type AuthenticatedUser = NonNullable<MaybeAuthType["user"]>;

export const adminAccessTokenHeader = "Admin-Access-Token" as const;
export const adminAccessTokenSecurityScheme = "admin-access-token" as const;

const authUserSelection = {
	id: user.id,
	name: user.name,
	email: user.email,
	image: user.image,
	bannedAt: user.bannedAt,
	createdAt: user.createdAt,
	updatedAt: user.updatedAt,
	preferences: user.preferences,
	emailVerified: user.emailVerified,
	twoFactorEnabled: user.twoFactorEnabled,
};

const getUserById = async (userId: string) => {
	const [foundUser] = await db
		.select(authUserSelection)
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);

	return (
		foundUser
			? {
					...foundUser,
					// oxlint-disable-next-line no-unsafe-type-assertion
					preferences: foundUser.preferences as AuthenticatedUser["preferences"],
				}
			: null
	) as AuthenticatedUser | null; // oxlint-disable-next-line no-unsafe-type-assertion
};

type ResolveAuthenticatedUserDeps = {
	getUserById: typeof getUserById;
	getInternalRequestAuth: typeof getInternalRequestAuth;
	getSession: (input: { headers: Headers }) => Promise<{ user: AuthenticatedUser } | null>;
};

export const resolveAuthenticatedUser = async (
	request: Request,
	deps: ResolveAuthenticatedUserDeps = {
		getUserById,
		getInternalRequestAuth,
		getSession: auth.api.getSession,
	},
): Promise<MaybeAuthType["user"]> => {
	const internalRequestAuth = deps.getInternalRequestAuth(request);
	if (internalRequestAuth) {
		if (!internalRequestAuth.userId.trim()) {
			return null;
		}

		return await deps.getUserById(internalRequestAuth.userId);
	}

	const session = await deps.getSession({ headers: request.headers });
	return session ? await deps.getUserById(session.user.id) : null;
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
