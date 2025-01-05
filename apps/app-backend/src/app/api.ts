import { swaggerUI } from "@hono/swagger-ui";
import { Hono } from "hono";
import { openAPIRouteHandler } from "hono-openapi";
import { auth, type MaybeAuthType } from "~/auth";
import { withSession } from "~/auth/middleware";
import { healthApi } from "~/modules/health/routes";
import { protectedApi } from "~/modules/protected/routes";

const openApiInfo = {
	version: "1.0.0",
	title: "Ryot App Backend API",
	description: "OpenAPI specification for app-owned backend routes",
};

export const apiApp = new Hono<{ Variables: MaybeAuthType }>();

apiApp
	.route("/health", healthApi)
	.get(
		"/openapi.json",
		openAPIRouteHandler(apiApp, {
			documentation: { info: openApiInfo, servers: [{ url: "/api" }] },
		}),
	)
	.get("/docs", swaggerUI({ url: "/api/openapi.json" }))
	.on(["POST", "GET"], "/auth/*", (c) => auth.handler(c.req.raw))
	.use("*", withSession)
	.route("/protected", protectedApi);

export type AppType = typeof apiApp;
