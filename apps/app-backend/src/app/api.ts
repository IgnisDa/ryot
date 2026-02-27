import { swaggerUI } from "@hono/swagger-ui";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import { auth, type MaybeAuthType } from "~/auth";
import { withSession } from "~/auth/middleware";
import { errorJsonResponse, jsonResponse } from "~/lib/openapi";
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

const meResponseSchema = z.object({
	user: z.unknown(),
	session: z.unknown().nullable(),
});

const meRoute = createRoute({
	path: "/",
	method: "get",
	tags: ["protected"],
	summary: "Get the current user session",
	responses: {
		200: jsonResponse("Authenticated session details", meResponseSchema),
		401: errorJsonResponse("Request is unauthenticated"),
	},
});

const protectedPaths = [
	"/me",
	"/app-config",
	"/sandbox",
	"/entities",
	"/entity-schemas",
];

const conditionalAuth = createMiddleware<{ Variables: MaybeAuthType }>(
	async (c, next) => {
		const url = new URL(c.req.url);
		const fullPath = url.pathname;

		const shouldProtect = protectedPaths.some(
			(p) => fullPath === `/api${p}` || fullPath.startsWith(`/api${p}/`),
		);

		if (shouldProtect) {
			const user = c.get("user");
			if (!user) return c.json({ error: "Unauthorized" }, 401);
		}

		return next();
	},
);

const meApp = new OpenAPIHono<{ Variables: MaybeAuthType }>().openapi(
	meRoute,
	async (c) => {
		const user = c.get("user");
		const session = c.get("session");
		return c.json({ user, session }, 200);
	},
);

export const apiApp = new OpenAPIHono<{ Variables: MaybeAuthType }>()
	.doc("/openapi.json", {
		openapi: "3.0.0",
		info: openApiInfo,
		servers: [{ url: "/api" }],
	})
	.get("/docs", swaggerUI({ url: "/api/openapi.json" }))
	.on(["POST", "GET"], "/auth/*", (c) => auth.handler(c.req.raw))
	.use("*", withSession)
	.use("*", conditionalAuth)
	.route("/health", healthApi)
	.route("/me", meApp)
	.route("/app-config", appConfigApi)
	.route("/sandbox", sandboxApi)
	.route("/entities", entitiesApi)
	.route("/entity-schemas", entitySchemasApi);

export type AppType = typeof apiApp;
