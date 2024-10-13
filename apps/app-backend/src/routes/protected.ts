import { Hono } from "hono";
import { requireAuth } from "../auth/middleware";

export const protectedApi = new Hono().use("*", requireAuth).get("/me", (c) => {
	const user = c.get("user");
	const session = c.get("session");
	return c.json({ user, session });
});
