import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import "dotenv/config";
import { Hono } from "hono";
import { auth, type MaybeAuthType } from "./auth";
import { withSession } from "./auth/middleware";
import { config } from "./config";
import { migrateDB } from "./db";
import {
	initializeQueues,
	initializeWorkers,
	shutdownQueues,
	shutdownWorkers,
} from "./queue";
import { initializeRedis, shutdownRedis } from "./redis";
import { protectedApi } from "./routes/protected";
import { initializeSandboxService, shutdownSandboxService } from "./sandbox";

const apiApp = new Hono<{ Variables: MaybeAuthType }>();

const route = apiApp
	.on(["POST", "GET"], "/auth/*", (c) => auth.handler(c.req.raw))
	.use("*", withSession)
	.route("/protected", protectedApi);

export type AppType = typeof route;

const app = new Hono();

app.route("/api", apiApp);

app.use("*", serveStatic({ root: "./client" }));

app.use("*", serveStatic({ path: "./client/_shell.html" }));

const main = async () => {
	await migrateDB();
	await initializeRedis();
	await initializeQueues();
	await initializeSandboxService();
	await initializeWorkers();

	const server = serve({ port: config.PORT, fetch: app.fetch }, (c) => {
		console.info(`Server listening on port ${c.port}...`);
	});

	let isShuttingDown = false;

	const shutdown = async () => {
		if (isShuttingDown) return;
		isShuttingDown = true;

		console.info("Shutting down server...");
		await shutdownWorkers();
		await shutdownQueues();
		await shutdownSandboxService();
		await shutdownRedis();
		server.close(() => {
			console.info("Server closed");
			process.exit(0);
		});
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
};

main().catch((err) => {
	console.error("Error starting server:", err);
	process.exit(1);
});
