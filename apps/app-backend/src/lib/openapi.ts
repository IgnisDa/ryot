import type { RouteConfig } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";
import { requireAuth } from "~/auth/middleware";

export const ERROR_CODES = {
	TIMEOUT: "timeout",
	NOT_FOUND: "not_found",
	INTERNAL_ERROR: "internal_error",
	UNAUTHENTICATED: "unauthenticated",
	VALIDATION_FAILED: "validation_failed",
	HEALTH_CHECK_FAILED: "health_check_failed",
} as const;

export const successResponse = <T>(data: T) => ({ data });

export const paginatedResponse = <T>(
	data: T[],
	meta: { total: number; page: number; hasMore: boolean },
) => ({ data, meta });

export const errorResponse = (code: string, message: string) => ({
	error: { code, message },
});

export const dataSchema = <T extends z.ZodType>(schema: T) =>
	z.object({ data: schema });

export const paginatedSchema = <T extends z.ZodType>(itemSchema: T) =>
	z.object({
		data: z.array(itemSchema),
		meta: z.object({
			total: z.number().int().nonnegative(),
			page: z.number().int().positive(),
			hasMore: z.boolean(),
		}),
	});

export const errorSchema = z.object({
	error: z.object({
		code: z.string(),
		message: z.string(),
	}),
});

export const errorResponseSchema = z.object({
	error: z.string(),
});

export const unknownObjectSchema = z.record(z.string(), z.unknown());

const jsonContent = <TSchema extends z.ZodType>(schema: TSchema) => ({
	"application/json": { schema },
});

export const jsonResponse = <TSchema extends z.ZodType>(
	description: string,
	schema: TSchema,
) => ({ description, content: jsonContent(schema) });

export const errorJsonResponse = (description: string, _code: string) =>
	jsonResponse(description, errorSchema);

export const payloadValidationErrorResponse = errorJsonResponse(
	"Request payload validation failed",
	ERROR_CODES.VALIDATION_FAILED,
);

export const pathParamValidationErrorResponse = errorJsonResponse(
	"Path parameter validation failed",
	ERROR_CODES.VALIDATION_FAILED,
);

export const createAuthRoute = <TRoute extends RouteConfig>(
	route: TRoute,
): TRoute => {
	return {
		...route,
		middleware: [requireAuth],
		security: [{ "X-Api-Key": [] }],
	};
};
