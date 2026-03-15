import promClient from "prom-client";
import { pool } from "~/lib/db";
import { redis } from "~/lib/redis";

let metricsInitialized = false;
let metricsInterval: ReturnType<typeof setInterval> | null = null;

export const initializeMetrics = () => {
	if (metricsInitialized) return;
	metricsInitialized = true;

	promClient.collectDefaultMetrics({ prefix: "app_" });

	metricsInterval = setInterval(() => {
		updateDbMetrics();
		updateRedisMetrics();
	}, 5000);
};

export const shutdownMetrics = () => {
	if (metricsInterval) {
		clearInterval(metricsInterval);
		metricsInterval = null;
	}
};

export const httpRequestDuration = new promClient.Histogram({
	buckets: [0.1, 0.5, 1, 2, 5],
	help: "HTTP request latency in seconds",
	name: "app_http_request_duration_seconds",
	labelNames: ["method", "route", "status"],
});

export const httpRequestTotal = new promClient.Counter({
	help: "Total HTTP requests",
	name: "app_http_requests_total",
	labelNames: ["method", "route", "status"],
});

export const dbConnectionPoolSize = new promClient.Gauge({
	name: "app_db_connection_pool_size",
	help: "Database connection pool size",
});

export const dbConnectionPoolAvailable = new promClient.Gauge({
	name: "app_db_connection_pool_available",
	help: "Available database connections in pool",
});

export const redisConnected = new promClient.Gauge({
	name: "app_redis_connected",
	help: "Redis connection status (1 = connected, 0 = disconnected)",
});

export const redisUsedMemory = new promClient.Gauge({
	name: "app_redis_used_memory_bytes",
	help: "Redis memory usage in bytes",
});

export const redisConnectedClients = new promClient.Gauge({
	name: "app_redis_connected_clients",
	help: "Number of clients connected to Redis",
});

export const redisTotalCommandsProcessed = new promClient.Counter({
	name: "app_redis_commands_processed_total",
	help: "Total number of commands processed by Redis",
});

export const redisKeySpaceHits = new promClient.Counter({
	name: "app_redis_key_space_hits_total",
	help: "Number of successful key lookups",
});

export const redisKeySpaceMisses = new promClient.Counter({
	help: "Number of failed key lookups",
	name: "app_redis_key_space_misses_total",
});

let lastKeySpaceHits = 0;
let lastKeySpaceMisses = 0;

export const updateDbMetrics = () => {
	dbConnectionPoolSize.set(pool.totalCount);
	dbConnectionPoolAvailable.set(pool.idleCount);
};

let lastCommandsProcessed = 0;

export const updateRedisMetrics = async () => {
	try {
		redisConnected.set(redis.status === "ready" ? 1 : 0);

		const info = await redis.info();
		const lines = info.split("\r\n");
		const stats: Record<string, string> = {};

		for (const line of lines) {
			if (line && !line.startsWith("#")) {
				const [key, value] = line.split(":");
				if (key && value) stats[key] = value;
			}
		}

		if (stats.used_memory)
			redisUsedMemory.set(Number.parseInt(stats.used_memory, 10));

		if (stats.connected_clients)
			redisConnectedClients.set(Number.parseInt(stats.connected_clients, 10));

		if (stats.total_commands_processed) {
			const currentCommands = Number.parseInt(
				stats.total_commands_processed,
				10,
			);
			if (lastCommandsProcessed > 0) {
				const delta = currentCommands - lastCommandsProcessed;
				if (delta > 0) redisTotalCommandsProcessed.inc(delta);
			}
			lastCommandsProcessed = currentCommands;
		}

		if (stats.keyspace_hits) {
			const currentHits = Number.parseInt(stats.keyspace_hits, 10);
			if (lastKeySpaceHits > 0) {
				const delta = currentHits - lastKeySpaceHits;
				if (delta > 0) redisKeySpaceHits.inc(delta);
			}
			lastKeySpaceHits = currentHits;
		}

		if (stats.keyspace_misses) {
			const currentMisses = Number.parseInt(stats.keyspace_misses, 10);
			if (lastKeySpaceMisses > 0) {
				const delta = currentMisses - lastKeySpaceMisses;
				if (delta > 0) redisKeySpaceMisses.inc(delta);
			}
			lastKeySpaceMisses = currentMisses;
		}
	} catch {
		redisConnected.set(0);
	}
};

export const getMetricsAsText = async () => {
	updateDbMetrics();
	await updateRedisMetrics();
	return promClient.register.metrics();
};
