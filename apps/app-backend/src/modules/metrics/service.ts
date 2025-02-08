import promClient from "prom-client";
import { pool } from "~/db";

let metricsInitialized = false;

export const initializeMetrics = () => {
	if (metricsInitialized) return;
	metricsInitialized = true;

	promClient.collectDefaultMetrics({ prefix: "app_" });

	setInterval(() => {
		updateDbMetrics();
	}, 5000);
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

export const updateDbMetrics = () => {
	dbConnectionPoolSize.set(pool.totalCount);
	dbConnectionPoolAvailable.set(pool.idleCount);
};

export const getMetricsAsText = async () => {
	updateDbMetrics();
	return promClient.register.metrics();
};
