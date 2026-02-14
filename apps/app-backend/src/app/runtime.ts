import { join } from "node:path";
import { serve } from "@hono/node-server";
import { config, IS_DEVELOPMENT } from "~/lib/config";
import { generateConfigDocs } from "~/lib/config/docs";
import { migrateDB } from "~/lib/db/migrate";
import { generateOpenApiTypes } from "~/lib/openapi-docs";
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
import { dispatchExerciseSeedJob } from "~/modules/fitness";
import { initializeMetrics } from "~/modules/system";
import { getServer } from "./server";

export const startServer = async () => {
	if (IS_DEVELOPMENT) {
		generateConfigDocs(
			join(
				import.meta.dir,
				"../../../../apps/docs/src/includes/app-backend-config-schema.md",
			),
		);
		await generateOpenApiTypes(
			join(
				import.meta.dir,
				"../../../../libs/generated/src/openapi/app-backend.d.ts",
			),
			`http://localhost:${config.port}`,
		);
	}

	initializeMetrics();
	await migrateDB();
	await initializeRedis();
	await initializeQueues();
	await initializeSandboxService();
	await initializeWorkers();
	await dispatchExerciseSeedJob();

	const app = getServer();
	const server = serve({ port: config.port, fetch: app.fetch }, (c) => {
		console.info(`Server listening on port ${c.port}...`);
	});

	let isShuttingDown = false;

	const shutdown = async () => {
		if (isShuttingDown) {
			return;
		}
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
