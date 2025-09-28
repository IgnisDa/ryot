import { Hono } from "hono";
import { requireAuth } from "../auth/middleware";
import { entitiesApi } from "./entities";
import { entitySchemasApi } from "./entity-schemas";
import { sandboxApi } from "./sandbox";

export const protectedApi = new Hono()
	.use("*", requireAuth)
	.get("/me", async (c) => {
		const user = c.get("user");
		const session = c.get("session");
		return c.json({ user, session });
	})
	.route("/sandbox", sandboxApi)
	.route("/entities", entitiesApi)
	.route("/entity-schemas", entitySchemasApi);
