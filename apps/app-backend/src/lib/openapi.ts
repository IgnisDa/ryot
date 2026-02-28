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

const createErrorSchema = (code: string, name: string) =>
	z
		.object({
			code: z.literal(code),
			message: z.string(),
		})
		.openapi(name);

export const commonErrors = {
	notFound: createErrorSchema(ERROR_CODES.NOT_FOUND, "NotFoundError"),
	unauthenticated: createErrorSchema(
		ERROR_CODES.UNAUTHENTICATED,
		"UnauthenticatedError",
	),
	validationFailed: createErrorSchema(
		ERROR_CODES.VALIDATION_FAILED,
		"ValidationFailedError",
	),
	timeout: createErrorSchema(ERROR_CODES.TIMEOUT, "TimeoutError"),
	internalError: createErrorSchema(
		ERROR_CODES.INTERNAL_ERROR,
		"InternalServerError",
	),
	healthCheckFailed: createErrorSchema(
		ERROR_CODES.HEALTH_CHECK_FAILED,
		"HealthCheckFailedError",
	),
} as const;

export const createErrorUnion = <T extends z.ZodTypeAny[]>(...errors: T) => {
	if (errors.length === 1) {
		return errors[0];
	}
	return z.discriminatedUnion("code", errors as any);
};

export const createErrorResponse = (
	description: string,
	...errors: z.ZodObject<any>[]
) => {
	const errorUnion = createErrorUnion(...errors);
	const schema = z.object({ error: errorUnion });
	return jsonResponse(description, schema);
};

export const unauthenticatedResponse = () =>
	createErrorResponse(
		"Request is unauthenticated",
		commonErrors.unauthenticated,
	);

export const notFoundResponse = (description = "Resource not found") =>
	createErrorResponse(description, commonErrors.notFound);

export const validationErrorResponse = (description = "Validation failed") =>
	createErrorResponse(description, commonErrors.validationFailed);

export const pathParamErrorResponse = () =>
	validationErrorResponse("Path parameter validation failed");

export const payloadErrorResponse = () =>
	validationErrorResponse("Request payload validation failed");

export const successResponse = <T>(data: T) => ({ data });

export const paginationMetaSchema = z.object({
	hasMore: z.boolean(),
	page: z.number().int().positive(),
	total: z.number().int().nonnegative(),
});

export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

export const paginatedResponse = <T>(data: T[], meta: PaginationMeta) => ({
	data,
	meta,
});

export const errorResponse = (code: string, message: string) => ({
	error: { code, message },
});

export const dataSchema = <T extends z.ZodType>(schema: T) =>
	z.object({ data: schema });

export const paginatedSchema = <T extends z.ZodType>(itemSchema: T) =>
	z.object({
		data: z.array(itemSchema),
		meta: paginationMetaSchema,
	});

export const errorSchema = z.object({
	error: z.object({ code: z.string(), message: z.string() }),
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

/**
 * @deprecated Use createErrorResponse() with commonErrors instead.
 * This function will be removed in a future version.
 * Example: createErrorResponse('Description', commonErrors.notFound)
 */
export const errorJsonResponse = (description: string, _code: string) =>
	jsonResponse(description, errorSchema);

/**
 * @deprecated Use payloadErrorResponse() instead.
 * This function will be removed in a future version.
 */
export const payloadValidationErrorResponse = errorJsonResponse(
	"Request payload validation failed",
	ERROR_CODES.VALIDATION_FAILED,
);

/**
 * @deprecated Use pathParamErrorResponse() instead.
 * This function will be removed in a future version.
 */
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
