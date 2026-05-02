import type { RouteConfig } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";

import { requireAuth } from "~/lib/auth/middleware";
import type { ServiceResult } from "~/lib/result";

import { ERROR_CODES, errorResponse } from "./errors";

const createErrorSchema = (code: string, name: string) =>
	z.object({ message: z.string(), code: z.literal(code) }).openapi(name);

export const commonErrors = {
	notFound: createErrorSchema(ERROR_CODES.NOT_FOUND, "NotFoundError"),
	timeout: createErrorSchema(ERROR_CODES.TIMEOUT, "TimeoutError"),
	unauthenticated: createErrorSchema(ERROR_CODES.UNAUTHENTICATED, "UnauthenticatedError"),
	validationFailed: createErrorSchema(ERROR_CODES.VALIDATION_FAILED, "ValidationFailedError"),
	internalError: createErrorSchema(ERROR_CODES.INTERNAL_ERROR, "InternalServerError"),
	healthCheckFailed: createErrorSchema(ERROR_CODES.HEALTH_CHECK_FAILED, "HealthCheckFailedError"),
} as const;

export const createErrorUnion = <T extends z.ZodTypeAny[]>(...errors: T) => {
	if (errors.length === 1) {
		return errors[0];
	}
	return z.discriminatedUnion("code", errors as never);
};

export const createErrorResponse = (
	description: string,
	...errors: z.ZodObject<z.ZodRawShape>[]
) => {
	const errorUnion = createErrorUnion(...errors);
	const schema = z.object({ error: errorUnion });
	return jsonResponse(description, schema);
};

export const unauthenticatedResponse = () =>
	createErrorResponse("Request is unauthenticated", commonErrors.unauthenticated);

export const notFoundResponse = (description = "Resource not found") =>
	createErrorResponse(description, commonErrors.notFound);

export const validationErrorResponse = (description = "Validation failed") =>
	createErrorResponse(description, commonErrors.validationFailed);

export const payloadErrorResponse = () =>
	validationErrorResponse("Request payload validation failed");

export const successResponse = <T>(data: T) => ({ data });

export const createSuccessResult = <T>(data: T) => ({
	status: 200 as const,
	body: successResponse(data),
});

export const createNotFoundErrorResult = (message = "Resource not found") => ({
	status: 404 as const,
	body: errorResponse(ERROR_CODES.NOT_FOUND, message),
});

export const createValidationErrorResult = (message: string) => ({
	status: 400 as const,
	body: errorResponse(ERROR_CODES.VALIDATION_FAILED, message),
});

export const createValidationServiceErrorResult = (result: {
	error: "validation";
	message: string;
}) => createValidationErrorResult(result.message);

export const createServiceErrorResult = <E extends string>(
	result: Extract<ServiceResult<never, E>, { error: E }>,
	input?: { notFoundErrors?: readonly E[] },
) => {
	const notFoundErrors = input?.notFoundErrors ?? (["not_found"] as E[]);

	return notFoundErrors.includes(result.error)
		? createNotFoundErrorResult(result.message)
		: createValidationErrorResult(result.message);
};

export const createCustomEntityAccessErrorResult = (input: {
	message: string;
	error: "builtin" | "not_found";
}) => {
	if (input.error === "not_found") {
		return createNotFoundErrorResult(input.message);
	}
	return createValidationErrorResult(input.message);
};

const resolveValidationResult = <T>(
	callback: () => T,
	fallback: string,
): { data: T } | { error: string } => {
	try {
		return { data: callback() } as const;
	} catch (error) {
		const message = error instanceof Error ? error.message : fallback;
		return { error: message } as const;
	}
};

export const resolveValidationData = <T>(
	callback: () => T,
	fallback: string,
): { data: T } | ReturnType<typeof createValidationErrorResult> => {
	const result = resolveValidationResult(callback, fallback);
	if ("error" in result) {
		return createValidationErrorResult(result.error);
	}
	return result;
};

export const dataSchema = <T extends z.ZodType>(schema: T) => z.object({ data: schema });

export const itemDataSchema = <T extends z.ZodType>(schema: T) => dataSchema(schema);

export const listDataSchema = <T extends z.ZodType>(schema: T) => dataSchema(z.array(schema));

export const unknownObjectSchema = z.record(z.string(), z.unknown());

export const jsonBody = <TSchema extends z.ZodType>(schema: TSchema) => ({
	content: { "application/json": { schema } },
});

export const createNullableOpenApiRefSchema = <TSchema extends z.ZodTypeAny>(
	schema: TSchema,
	input: { ref: string; name: string },
) =>
	z
		.any()
		.transform((value, ctx) => {
			const result = schema.safeParse(value);
			if (result.success) {
				return result.data;
			}

			for (const issue of result.error.issues) {
				ctx.addIssue(issue as never);
			}

			return z.NEVER;
		})
		.openapi(input.name, {
			nullable: true,
			allOf: [{ $ref: `#/components/schemas/${input.ref}` }],
		} as never) as unknown as z.ZodType<z.infer<TSchema>>;

export const createStandardResponses = <TSchema extends z.ZodType>(input: {
	successSchema: TSchema;
	successDescription: string;
	notFoundDescription?: string;
	includePayloadError?: boolean;
}) => ({
	...(input.includePayloadError === false ? {} : { 400: payloadErrorResponse() }),
	...(input.notFoundDescription ? { 404: notFoundResponse(input.notFoundDescription) } : {}),
	200: jsonResponse(input.successDescription, input.successSchema),
});

const jsonContent = <TSchema extends z.ZodType>(schema: TSchema) => ({
	"application/json": { schema },
});

export const jsonResponse = <TSchema extends z.ZodType>(description: string, schema: TSchema) => ({
	description,
	content: jsonContent(schema),
});

export const createAuthRoute = <TRoute extends RouteConfig>(route: TRoute) => ({
	...route,
	middleware: [requireAuth],
	security: [{ "X-Api-Key": [] }],
	responses: { 401: unauthenticatedResponse(), ...route.responses },
});
