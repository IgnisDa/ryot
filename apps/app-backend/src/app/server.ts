import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { HonoAdapter } from "@bull-board/hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { getQueues } from "~/lib/queue";
import { metricsMiddleware } from "~/modules/system/middleware";
import { apiApp } from "./api";

export const getServer = () => {
	const app = new Hono()
		.use("*", metricsMiddleware)
		.route("/api", apiApp)
		.use("*", serveStatic({ root: "./client" }))
		.use("*", serveStatic({ path: "./client/_shell.html" }));

	const systemBackgroundEndpoint = "/api/system/background";
	const serverAdapter = new HonoAdapter(serveStatic);
	createBullBoard({
		serverAdapter,
		queues: [new BullMQAdapter(getQueues().sandboxScriptQueue)],
	});
	serverAdapter.setBasePath(systemBackgroundEndpoint);
	app.route(systemBackgroundEndpoint, serverAdapter.registerPlugin());
	return app;
};
