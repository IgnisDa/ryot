import type { Context } from "hono";
import type { StatusCode } from "hono/utils/http-status";

export const errorResponse = (c: Context, error: string, status: StatusCode) =>
	c.json({ error }, status as never);

export const successResponse = <T>(
	c: Context,
	data: T,
	status: StatusCode = 200,
) => c.json(data, status as never);
