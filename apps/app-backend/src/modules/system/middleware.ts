import { dayjs } from "@ryot/ts-utils";
import type { Context, Next } from "hono";
import { httpRequestDuration, httpRequestTotal } from "./service";

export const metricsMiddleware = async (c: Context, next: Next) => {
	const start = dayjs();
	const method = c.req.method;
	let route = c.req.path;

	route = route.replace(/\/api\/[^/]+\/[a-f0-9-]+/g, (match) => {
		const parts = match.split("/");
		parts[parts.length - 1] = ":id";
		return parts.join("/");
	});

	await next();

	const duration = dayjs().diff(start, "millisecond") / 1000;
	const status = c.res.status;

	httpRequestDuration.observe(
		{ method, route, status: String(status) },
		duration,
	);
	httpRequestTotal.inc({ method, route, status: String(status) });
};
