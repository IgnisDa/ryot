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
	z.object({ message: z.string(), code: z.literal(code) }).openapi(name);

export const commonErrors = {
	notFound: createErrorSchema(ERROR_CODES.NOT_FOUND, "NotFoundError"),
	timeout: createErrorSchema(ERROR_CODES.TIMEOUT, "TimeoutError"),
	unauthenticated: createErrorSchema(
		ERROR_CODES.UNAUTHENTICATED,
		"UnauthenticatedError",
	),
	validationFailed: createErrorSchema(
		ERROR_CODES.VALIDATION_FAILED,
		"ValidationFailedError",
	),
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
	if (errors.length === 1) return errors[0];
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

export const unknownObjectSchema = z.record(z.string(), z.unknown());

const jsonContent = <TSchema extends z.ZodType>(schema: TSchema) => ({
	"application/json": { schema },
});

export const jsonResponse = <TSchema extends z.ZodType>(
	description: string,
	schema: TSchema,
) => ({ description, content: jsonContent(schema) });

export const createAuthRoute = <TRoute extends RouteConfig>(route: TRoute) => ({
	...route,
	middleware: [requireAuth],
	security: [{ "X-Api-Key": [] }],
	responses: { 401: unauthenticatedResponse(), ...route.responses },
});
