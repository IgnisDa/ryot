import "dotenv/config";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { type AuthType, auth, type MaybeAuthType } from "./utils/auth";

const requireAuth = createMiddleware<{ Variables: AuthType }>(
	async (c, next) => {
		const user = c.get("user");
		if (!user) return c.json({ error: "Unauthorized" }, 401);
		return next();
	},
);

const protectedApi = new Hono().use("*", requireAuth).get("/", (c) => {
	const user = c.get("user");
	console.log("Protected API accessed by user:", user);
	return c.json(user);
});

const app = new Hono<{ Variables: MaybeAuthType }>().basePath("/api");

const route = app
	.on(["POST", "GET"], "/auth/*", (c) => auth.handler(c.req.raw))
	.use("*", async (c, next) => {
		const session = await auth.api.getSession({ headers: c.req.raw.headers });
		c.set("user", session?.user || null);
		c.set("session", session?.session || null);
		return next();
	})
	.route("/protected", protectedApi);

export type AppType = typeof route;

export default app;
