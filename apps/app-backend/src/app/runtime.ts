import { serve } from "@hono/node-server";
import { config } from "~/lib/config";
import { migrateDB } from "~/lib/db";
import {
	initializeQueues,
	initializeWorkers,
	shutdownQueues,
	shutdownWorkers,
} from "~/lib/queue";
import { initializeRedis, shutdownRedis } from "~/lib/redis";
import {
	initializeSandboxService,
	shutdownSandboxService,
} from "~/lib/sandbox";
import { initializeMetrics, shutdownMetrics } from "~/modules/system/service";
import { app } from "./server";

export const startServer = async () => {
	initializeMetrics();
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

		const gracefulShutdownTimeout = 30_000;
		const forceExitTimeout = setTimeout(() => {
			console.error(
				"Graceful shutdown timed out, forcing exit after 30 seconds",
			);
			process.exit(1);
		}, gracefulShutdownTimeout);

		try {
			await shutdownWorkers();
			await shutdownQueues();
			await shutdownSandboxService();
			await shutdownRedis();
			shutdownMetrics();
			server.close(() => {
				console.info("Server closed");
				clearTimeout(forceExitTimeout);
				process.exit(0);
			});
		} catch (error) {
			console.error("Error during shutdown:", error);
			clearTimeout(forceExitTimeout);
			process.exit(1);
		}
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
};
