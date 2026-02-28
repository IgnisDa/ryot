import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { requireAuth } from "~/auth/middleware";
import { jsonResponse, protectedRouteSpec } from "~/lib/openapi";
import { successResponse } from "~/lib/response";
import { appConfigApi } from "~/modules/app-config/routes";
import { entitiesApi } from "~/modules/entities/routes";
import { entitySchemasApi } from "~/modules/entity-schemas/routes";
import { sandboxApi } from "~/modules/sandbox/routes";

const meResponseSchema = z.object({
	user: z.record(z.string(), z.unknown()),
	session: z.record(z.string(), z.unknown()).nullable(),
});

export const protectedApi = new Hono()
	.use("*", requireAuth)
	.get(
		"/me",
		describeRoute(
			protectedRouteSpec({
				tags: ["protected"],
				summary: "Get the current user session",
				responses: {
					200: jsonResponse("Authenticated session details", meResponseSchema),
				},
			}),
		),
		async (c) => {
			const user = c.get("user");
			const session = c.get("session");
			return successResponse(c, { user, session });
		},
	)
	.route("/app-config", appConfigApi)
	.route("/sandbox", sandboxApi)
	.route("/entities", entitiesApi)
	.route("/entity-schemas", entitySchemasApi);
