import promClient from "prom-client";

export const sandboxExecutionsTotal = new promClient.Counter({
	labelNames: ["outcome"] as const,
	name: "app_sandbox_executions_total",
	help: "Total sandbox executions by outcome",
});

export const sandboxPoolHitsTotal = new promClient.Counter({
	name: "app_sandbox_pool_hits_total",
	help: "Total sandbox executions served from the pre-warmed process pool",
});

export const sandboxExecutionDurationSeconds = new promClient.Histogram({
	labelNames: ["outcome"] as const,
	buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
	name: "app_sandbox_execution_duration_seconds",
	help: "End-to-end sandbox execution duration in seconds",
});

export const sandboxScriptExecutionDurationSeconds = new promClient.Histogram({
	buckets: [0.05, 0.1, 0.25, 0.5, 1, 2],
	name: "app_sandbox_script_execution_duration_seconds",
	help: "Duration of the user script body execution in seconds",
});
