import { NodeSdk } from "@effect/opentelemetry";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { Metric } from "effect";

export const httpRequestCount = Metric.counter("http.requests.total", {
	description: "Total HTTP requests handled by the reference app",
});

export const OtelLive = NodeSdk.layer(() => ({
	resource: { serviceName: "ryot-backend-reference" },
	metricReader: new PeriodicExportingMetricReader({
		exporter: new OTLPMetricExporter(),
	}),
}));
