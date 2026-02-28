import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { auth, type MaybeAuthType } from "~/auth";
import { requireAuth, withSession } from "~/auth/middleware";
import { healthApi } from "~/modules/health/routes";
import { protectedApi } from "~/modules/protected/routes";

const openApiInfo = {
	version: "1.0.0",
	title: "Ryot App Backend API",
	description: "OpenAPI specification for app-owned backend routes",
};

const baseApp = new OpenAPIHono<{ Variables: MaybeAuthType }>()
	.route("/health", healthApi)
	.route("/protected", protectedApi);

export const apiApp = baseApp
	.doc("/openapi.json", {
		openapi: "3.0.0",
		info: openApiInfo,
		servers: [{ url: "/api" }],
	})
	.get("/docs", swaggerUI({ url: "/api/openapi.json" }))
	.on(["POST", "GET"], "/auth/*", (c) => auth.handler(c.req.raw))
	.use("*", withSession)
	.use("/protected/*", requireAuth);

export type AppType = typeof baseApp;
