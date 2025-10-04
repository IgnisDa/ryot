import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { adminAccessTokenHeader } from "~/lib/auth";
import { config } from "~/lib/config";
import { metricsMiddleware } from "~/modules/system";

import { apiApp } from "./api";

export const getServer = () => {
	const corsOrigins = Array.from(new Set([config.frontendUrl, ...config.server.corsOrigins]));
	const corsMiddleware = cors({
		credentials: true,
		origin: corsOrigins,
		allowMethods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
		allowHeaders: ["Accept", adminAccessTokenHeader, "Content-Type", "X-Api-Key"],
	});

	const app = new Hono()
		.use("*", metricsMiddleware)
		.use("*", corsMiddleware)
		.route("/api", apiApp)
		.use("*", serveStatic({ root: "./client" }))
		.use("*", serveStatic({ path: "./client/index.html" }));

	return app;
};
