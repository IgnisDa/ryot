import { Hono } from "hono";
import { requireAuth } from "~/auth/middleware";
import { successResponse } from "~/lib/response";
import { entitiesApi } from "~/modules/entities/routes";
import { entitySchemasApi } from "~/modules/entity-schemas/routes";
import { sandboxApi } from "~/modules/sandbox/routes";

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
