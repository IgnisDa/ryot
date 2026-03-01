import { createMiddleware } from "hono/factory";
import { auth, type MaybeAuthType } from ".";

export const requireAuth = createMiddleware<{ Variables: MaybeAuthType }>(
	async (c, next) => {
		try {
			const session = await auth.api.getSession({ headers: c.req.raw.headers });
			if (!session?.user) return c.json({ error: "Unauthorized" }, 401);
			c.set("user", session.user);
			c.set("session", session.session);
			return next();
		} catch {
			return c.json({ error: "Forbidden" }, 403);
		}
	},
);
