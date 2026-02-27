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

const typedApiApp = new Hono<{ Variables: MaybeAuthType }>()
	.route("/health", healthApi)
	.on(["POST", "GET"], "/auth/*", (c) => auth.handler(c.req.raw))
	.use("*", withSession)
	.route("/protected", protectedApi);

export const apiApp = new Hono<{ Variables: MaybeAuthType }>()
	.get(
		"/openapi.json",
		openAPIRouteHandler(typedApiApp, {
			documentation: { info: openApiInfo, servers: [{ url: "/api" }] },
		}),
	)
	.get("/docs", swaggerUI({ url: "/api/openapi.json" }))
	.route("/", typedApiApp);

export type AppType = typeof typedApiApp;
