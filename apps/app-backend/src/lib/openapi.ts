import { type DescribeRouteOptions, resolver } from "hono-openapi";
import { z } from "zod";

export const errorResponseSchema = z.object({
	error: z.string(),
});

export const unknownObjectSchema = z.record(z.string(), z.unknown());

type OpenApiResponses = NonNullable<DescribeRouteOptions["responses"]>;

const jsonContent = <TSchema extends z.ZodType>(schema: TSchema) => ({
	"application/json": { schema: resolver(schema) },
});

export const jsonResponse = <TSchema extends z.ZodType>(
	description: string,
	schema: TSchema,
) => ({ description, content: jsonContent(schema) });

export const authErrorResponse = jsonResponse(
	"Request is unauthenticated",
	errorResponseSchema,
);

export const payloadValidationErrorResponse = jsonResponse(
	"Request payload validation failed",
	unknownObjectSchema,
);

export const pathParamValidationErrorResponse = jsonResponse(
	"Path parameter validation failed",
	unknownObjectSchema,
);

export const errorJsonResponse = (description: string) =>
	jsonResponse(description, errorResponseSchema);

export const protectedRouteSpec = (input: {
	tags: string[];
	summary: string;
	responses: OpenApiResponses;
}) => ({
	tags: input.tags,
	summary: input.summary,
	responses: { ...input.responses, 401: authErrorResponse },
});
