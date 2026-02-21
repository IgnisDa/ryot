import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { metricsMiddleware } from "~/modules/system";
import { apiApp } from "./api";

export const getServer = () => {
	const app = new Hono()
		.use("*", metricsMiddleware)
		.route("/api", apiApp)
		.use("*", serveStatic({ root: "./client" }))
		.use("*", serveStatic({ path: "./client/index.html" }));

	return app;
};
