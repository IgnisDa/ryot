import { Hono } from "hono";
import { requireAuth } from "../auth/middleware";
import { getQueues } from "../queue";

export const protectedApi = new Hono()
	.use("*", requireAuth)
	.get("/me", async (c) => {
		const user = c.get("user");
		const session = c.get("session");

		const queues = getQueues();
		await queues.exampleQueue.add("user-login", {
			message: `User ${user.id} accessed /me endpoint`,
		});

		return c.json({ user, session });
	});
