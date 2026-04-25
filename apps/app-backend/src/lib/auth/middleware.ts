import { isAPIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { getInternalRequestAuth } from "~/app/internal-auth";
import { db } from "~/lib/db";
import { user } from "~/lib/db/schema";
import { ERROR_CODES, errorResponse } from "../openapi";
import { auth, type MaybeAuthType } from ".";

type AuthenticatedUser = NonNullable<MaybeAuthType["user"]>;

const authUserSelection = {
	id: user.id,
	name: user.name,
	email: user.email,
	image: user.image,
	createdAt: user.createdAt,
	updatedAt: user.updatedAt,
	preferences: user.preferences,
	emailVerified: user.emailVerified,
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
					preferences:
						foundUser.preferences as AuthenticatedUser["preferences"],
				}
			: null
	) as AuthenticatedUser | null;
};

type ResolveAuthenticatedUserDeps = {
	getUserById: typeof getUserById;
	getInternalRequestAuth: typeof getInternalRequestAuth;
	getSession: (input: {
		headers: Headers;
	}) => Promise<{ user: AuthenticatedUser } | null>;
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
	return session?.user ?? null;
};

export const requireAuth = createMiddleware<{ Variables: MaybeAuthType }>(
	async (c, next) => {
		try {
			const authenticatedUser = await resolveAuthenticatedUser(c.req.raw);
			if (!authenticatedUser) {
				return c.json(
					errorResponse(ERROR_CODES.UNAUTHENTICATED, "Authentication required"),
					401,
				);
			}
			c.set("user", authenticatedUser);
			return next();
		} catch (error) {
			if (isAPIError(error)) {
				if (error.body?.code === "RATE_LIMITED") {
					const tryAgainIn = error.body.details?.tryAgainIn;
					return c.json(
						errorResponse(
							ERROR_CODES.RATE_LIMITED,
							`Please try again in ${tryAgainIn}ms.`,
						),
						429,
					);
				}
			}
			return c.json(
				errorResponse(ERROR_CODES.UNAUTHENTICATED, "Authentication required"),
				401,
			);
		}
	},
);
