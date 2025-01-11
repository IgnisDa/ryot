import { createMiddleware } from "hono/factory";
import { ERROR_CODES, errorResponse } from "../lib/openapi";
import { auth, type MaybeAuthType } from ".";

export const requireAuth = createMiddleware<{ Variables: MaybeAuthType }>(
	async (c, next) => {
		try {
			const session = await auth.api.getSession({ headers: c.req.raw.headers });
			if (!session?.user)
				return c.json(
					errorResponse(ERROR_CODES.UNAUTHENTICATED, "Authentication required"),
					401,
				);
			c.set("user", session.user);
			c.set("session", session.session);
			return next();
		} catch {
			return c.json(
				errorResponse(ERROR_CODES.UNAUTHENTICATED, "Authentication required"),
				401,
			);
		}
	},
);
