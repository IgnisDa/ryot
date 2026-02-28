import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { auth, type MaybeAuthType } from "~/auth";
import { withSession } from "~/auth/middleware";
import { healthApi } from "~/modules/health/routes";
import { protectedApi } from "~/modules/protected/routes";

const openApiInfo = {
	version: "1.0.0",
	title: "Ryot App Backend API",
	description: "OpenAPI specification for app-owned backend routes",
};

export const apiApp = new OpenAPIHono<{ Variables: MaybeAuthType }>();

apiApp.route("/health", healthApi);
apiApp.doc("/openapi.json", {
	openapi: "3.0.0",
	info: openApiInfo,
	servers: [{ url: "/api" }],
});
apiApp.get("/docs", swaggerUI({ url: "/api/openapi.json" }));
apiApp.on(["POST", "GET"], "/auth/*", (c) => auth.handler(c.req.raw));
apiApp.use("*", withSession);
apiApp.route("/protected", protectedApi);

export type AppType = typeof apiApp;
