import { swaggerUI } from "@hono/swagger-ui";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { auth, type MaybeAuthType } from "~/auth";
import {
	createAuthRoute,
	dataSchema,
	ERROR_CODES,
	errorJsonResponse,
	jsonResponse,
	successResponse,
} from "~/lib/openapi";
import { appConfigApi } from "~/modules/app-config/routes";
import { entitiesApi } from "~/modules/entities/routes";
import { entitySchemasApi } from "~/modules/entity-schemas/routes";
import { healthApi } from "~/modules/health/routes";
import { sandboxApi } from "~/modules/sandbox/routes";

const openApiInfo = {
	version: "1.0.0",
	title: "Ryot App Backend API",
	description: "OpenAPI specification for app-owned backend routes",
};

const meResponseSchema = dataSchema(
	z.object({
		user: z.unknown(),
		session: z.unknown().nullable(),
	}),
);

const meRoute = createAuthRoute(
	createRoute({
		path: "/me",
		method: "get",
		tags: ["protected"],
		summary: "Get the current user session",
		responses: {
			401: errorJsonResponse(
				"Request is unauthenticated",
				ERROR_CODES.UNAUTHENTICATED,
			),
			200: jsonResponse("Authenticated session details", meResponseSchema),
		},
	}),
);

const baseApp = new OpenAPIHono<{ Variables: MaybeAuthType }>()
	.route("/health", healthApi)
	.openapi(meRoute, async (c) => {
		const user = c.get("user");
		const session = c.get("session");
		return c.json(successResponse({ user, session }), 200);
	})
	.route("/app-config", appConfigApi)
	.route("/sandbox", sandboxApi)
	.route("/entities", entitiesApi)
	.route("/entity-schemas", entitySchemasApi);

export const apiApp = baseApp
	.doc("/openapi.json", (c) => ({
		openapi: "3.0.0",
		info: openApiInfo,
		servers: [{ url: `${new URL(c.req.url).origin}/api` }],
	}))
	.get("/docs", swaggerUI({ url: "/api/openapi.json" }))
	.on(["POST", "GET"], "/auth/*", (c) => auth.handler(c.req.raw));

baseApp.openAPIRegistry.registerComponent("securitySchemes", "X-Api-Key", {
	in: "header",
	type: "apiKey",
	name: "X-Api-Key",
});

export type AppType = typeof baseApp;
