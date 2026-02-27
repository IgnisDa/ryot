import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AuthType } from "~/auth";
import { requireAuth } from "~/auth/middleware";
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

export const protectedApi = new OpenAPIHono<{ Variables: AuthType }>();

protectedApi.use("*", requireAuth);
protectedApi.openapi(meRoute, async (c) => {
	const user = c.get("user");
	const session = c.get("session");
	return c.json({ user, session }, 200);
});
protectedApi.route("/app-config", appConfigApi);
protectedApi.route("/sandbox", sandboxApi);
protectedApi.route("/entities", entitiesApi);
protectedApi.route("/entity-schemas", entitySchemasApi);
