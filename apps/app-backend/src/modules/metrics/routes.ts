import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { getMetricsAsText, initializeMetrics } from "./service";

const metricsRoute = createRoute({
	path: "/",
	method: "get",
	tags: ["system"],
	summary: "Export metrics in Prometheus format",
	responses: {
		200: {
			description: "Prometheus metrics in text format",
			content: { "text/plain": { schema: z.string() } },
		},
	},
});

export const metricsApi = new OpenAPIHono().openapi(metricsRoute, async (c) => {
	initializeMetrics();
	const metricsText = await getMetricsAsText();
	return c.text(metricsText, 200, {
		"Content-Type": "text/plain; charset=utf-8",
	});
});
