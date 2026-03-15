import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { auth, type MaybeAuthType } from "~/lib/auth";
import { ERROR_CODES, errorResponse } from "~/lib/openapi";
import { authenticationApi } from "~/modules/authentication/routes";
import { entitiesApi } from "~/modules/entities/routes";
import { entitySchemasApi } from "~/modules/entity-schemas/routes";
import { eventSchemasApi } from "~/modules/event-schemas/routes";
import { eventsApi } from "~/modules/events/routes";
import { facetsApi } from "~/modules/facets/routes";
import { healthApi } from "~/modules/health/routes";
import { metricsApi } from "~/modules/metrics/routes";
import { sandboxApi } from "~/modules/sandbox/routes";
import { savedViewsApi } from "~/modules/saved-views/routes";

const openApiInfo = {
	version: "1.0.0",
	title: "Ryot App Backend API",
	description: "OpenAPI specification for app-owned backend routes",
};

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
	.route("/authentication", authenticationApi)
	.route("/sandbox", sandboxApi)
	.route("/facets", facetsApi)
	.route("/entity-schemas", entitySchemasApi)
	.route("/entities", entitiesApi)
	.route("/event-schemas", eventSchemasApi)
	.route("/events", eventsApi)
	.route("/saved-views", savedViewsApi);

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
