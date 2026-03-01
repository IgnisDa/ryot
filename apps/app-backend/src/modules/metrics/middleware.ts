import type { Context, Next } from "hono";
import { httpRequestDuration, httpRequestTotal } from "./service";

export const metricsMiddleware = async (c: Context, next: Next) => {
	const start = Date.now();
	const method = c.req.method;
	let route = c.req.path;

	route = route.replace(/\/api\/[^/]+\/[a-f0-9-]+/g, (match) => {
		const parts = match.split("/");
		parts[parts.length - 1] = ":id";
		return parts.join("/");
	});

	await next();

	const duration = (Date.now() - start) / 1000;
	const status = c.res.status;

	httpRequestDuration.observe(
		{ method, route, status: String(status) },
		duration,
	);
	httpRequestTotal.inc({ method, route, status: String(status) });
};
