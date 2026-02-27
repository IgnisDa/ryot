import { serve } from "@hono/node-server";
import { migrateDB } from "~/db";
import { config } from "~/lib/config";
import { initializeRedis, shutdownRedis } from "~/lib/redis";
import {
	initializeQueues,
	initializeWorkers,
	shutdownQueues,
	shutdownWorkers,
} from "~/queue";
import { initializeSandboxService, shutdownSandboxService } from "~/sandbox";
import { app } from "./server";

export const startServer = async () => {
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
