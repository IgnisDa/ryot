import { createMiddleware } from "hono/factory";
import { type AuthType, auth, type MaybeAuthType } from ".";

export const requireAuth = createMiddleware<{ Variables: AuthType }>(
	async (c, next) => {
		const user = c.get("user");
		if (!user) return c.json({ error: "Unauthorized" }, 401);
		return next();
	},
);

export const withSession = createMiddleware<{ Variables: MaybeAuthType }>(
	async (c, next) => {
		const session = await auth.api.getSession({ headers: c.req.raw.headers });
		c.set("user", session?.user || null);
		c.set("session", session?.session || null);
		return next();
	},
);
