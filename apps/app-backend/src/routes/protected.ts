import { Hono } from "hono";
import { requireAuth } from "~/auth/middleware";
import { successResponse } from "~/lib/response";
import { entitiesApi } from "./entities";
import { entitySchemasApi } from "./entity-schemas";
import { sandboxApi } from "./sandbox";

export const protectedApi = new Hono()
	.use("*", requireAuth)
	.get("/me", async (c) => {
		const user = c.get("user");
		const session = c.get("session");
		return successResponse(c, { user, session });
	})
	.route("/sandbox", sandboxApi)
	.route("/entities", entitiesApi)
	.route("/entity-schemas", entitySchemasApi);
