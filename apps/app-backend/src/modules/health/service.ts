import promClient from "prom-client";

let metricsInitialized = false;

export const initializeMetrics = () => {
	if (metricsInitialized) return;
	metricsInitialized = true;

	// Default collectors: CPU, memory, file descriptors, GC, event loop lag
	promClient.collectDefaultMetrics({ prefix: "app_" });
};

// HTTP metrics
export const httpRequestDuration = new promClient.Histogram({
	name: "app_http_request_duration_seconds",
	help: "HTTP request latency in seconds",
	labelNames: ["method", "route", "status"],
	buckets: [0.1, 0.5, 1, 2, 5],
});

export const httpRequestTotal = new promClient.Counter({
	name: "app_http_requests_total",
	help: "Total HTTP requests",
	labelNames: ["method", "route", "status"],
});

// Database metrics
export const dbConnectionPoolSize = new promClient.Gauge({
	name: "app_db_connection_pool_size",
	help: "Database connection pool size",
});

export const dbConnectionPoolAvailable = new promClient.Gauge({
	name: "app_db_connection_pool_available",
	help: "Available database connections in pool",
});

export const getMetricsAsText = async () => {
	return promClient.register.metrics();
};
