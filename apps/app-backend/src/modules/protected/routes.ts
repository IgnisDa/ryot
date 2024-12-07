import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AuthType } from "~/auth";
import { errorJsonResponse, jsonResponse } from "~/lib/openapi";
import { appConfigApi } from "~/modules/app-config/routes";
import { entitiesApi } from "~/modules/entities/routes";
import { entitySchemasApi } from "~/modules/entity-schemas/routes";
import { sandboxApi } from "~/modules/sandbox/routes";

const meResponseSchema = z.object({
	user: z.unknown(),
	session: z.unknown().nullable(),
});

const meRoute = createRoute({
	path: "/me",
	method: "get",
	tags: ["protected"],
	summary: "Get the current user session",
	responses: {
		200: jsonResponse("Authenticated session details", meResponseSchema),
		401: errorJsonResponse("Request is unauthenticated"),
	},
});

export const protectedApi = new OpenAPIHono<{ Variables: AuthType }>()
	.openapi(meRoute, async (c) => {
		const user = c.get("user");
		const session = c.get("session");
		return c.json({ user, session }, 200);
	})
	.route("/app-config", appConfigApi)
	.route("/sandbox", sandboxApi)
	.route("/entities", entitiesApi)
	.route("/entity-schemas", entitySchemasApi);
