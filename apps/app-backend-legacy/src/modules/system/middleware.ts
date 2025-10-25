import { dayjs } from "@ryot/ts-utils/dayjs";
import type { Context, Next } from "hono";
import { routePath } from "hono/route";

import { httpRequestDuration, httpRequestTotal } from "./service";

export const metricsMiddleware = async (c: Context, next: Next) => {
	const start = dayjs();

	await next();

	const duration = dayjs().diff(start, "millisecond") / 1000;
	const method = c.req.method;
	const route = routePath(c, -1);
	const status = c.res.status;

	httpRequestDuration.observe({ method, route, status: String(status) }, duration);
	httpRequestTotal.inc({ method, route, status: String(status) });
};
