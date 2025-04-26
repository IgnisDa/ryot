import { swaggerUI } from "@hono/swagger-ui";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { auth, type MaybeAuthType } from "~/auth";
import {
	createAuthRoute,
	dataSchema,
	ERROR_CODES,
	errorResponse,
	jsonResponse,
	successResponse,
} from "~/lib/openapi";
import { entitiesApi } from "~/modules/entities/routes";
import { entitySchemasApi } from "~/modules/entity-schemas/routes";
import { eventSchemasApi } from "~/modules/event-schemas/routes";
import { facetsApi } from "~/modules/facets/routes";
import { healthApi } from "~/modules/health/routes";
import { metricsApi } from "~/modules/metrics/routes";
import { sandboxApi } from "~/modules/sandbox/routes";

const openApiInfo = {
	version: "1.0.0",
	title: "Ryot App Backend API",
	description: "OpenAPI specification for app-owned backend routes",
};

const meResponseSchema = dataSchema(
	z.object({
		user: z.unknown(),
		session: z.unknown().nullish(),
	}),
);

const meRoute = createAuthRoute(
	createRoute({
		path: "/me",
		method: "get",
		tags: ["protected"],
		summary: "Get the current user session",
		responses: {
			200: jsonResponse("Authenticated session details", meResponseSchema),
		},
	}),
);

export const baseApp = new OpenAPIHono<{ Variables: MaybeAuthType }>()
	.onError((error, c) => {
		if (error instanceof HTTPException)
			return c.json(
				errorResponse(ERROR_CODES.INTERNAL_ERROR, error.message),
				error.status,
			);

		if (error instanceof Error)
			return c.json(
				errorResponse(ERROR_CODES.INTERNAL_ERROR, error.message),
				500,
			);

		return c.json(
			errorResponse(ERROR_CODES.INTERNAL_ERROR, "An unexpected error occurred"),
			500,
		);
	})
	.route("/health", healthApi)
	.route("/metrics", metricsApi)
	.openapi(meRoute, async (c) => {
		const user = c.get("user");
		const session = c.get("session");
		return c.json(successResponse({ user, session }), 200);
	})
	.route("/sandbox", sandboxApi)
	.route("/facets", facetsApi)
	.route("/entity-schemas", entitySchemasApi)
	.route("/entities", entitiesApi)
	.route("/event-schemas", eventSchemasApi);

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
