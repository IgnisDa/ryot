import { Hono } from "hono";
import { requireAuth } from "../auth/middleware";

export const protectedApi = new Hono().use("*", requireAuth).get("/", (c) => {
	const user = c.get("user");
	console.log("Protected API accessed by user:", user);
	return c.json(user);
});
