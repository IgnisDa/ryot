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
import { initializeWorker, shutdownWorker } from "~/worker";
import { app } from "./server";

export const startServer = async () => {
	let redisInitialized = false;
	let queuesInitialized = false;
	let sandboxServiceInitialized = false;
	let workersInitialized = false;
	let workerInitialized = false;

	try {
		await migrateDB();
		await initializeRedis();
		redisInitialized = true;
		await initializeQueues();
		queuesInitialized = true;
		await initializeSandboxService();
		sandboxServiceInitialized = true;
		await initializeWorkers();
		workersInitialized = true;
		await initializeWorker();
		workerInitialized = true;
	} catch (error) {
		if (workerInitialized) {
			try {
				await shutdownWorker();
			} catch (shutdownError) {
				console.error("Error during startup rollback:", shutdownError);
			}
		}

		if (workersInitialized) {
			try {
				await shutdownWorkers();
			} catch (shutdownError) {
				console.error("Error during startup rollback:", shutdownError);
			}
		}

		if (queuesInitialized) {
			try {
				await shutdownQueues();
			} catch (shutdownError) {
				console.error("Error during startup rollback:", shutdownError);
			}
		}

		if (sandboxServiceInitialized) {
			try {
				await shutdownSandboxService();
			} catch (shutdownError) {
				console.error("Error during startup rollback:", shutdownError);
			}
		}

		if (redisInitialized) {
			try {
				await shutdownRedis();
			} catch (shutdownError) {
				console.error("Error during startup rollback:", shutdownError);
			}
		}

		throw error;
	}

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
			await shutdownWorker();
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
