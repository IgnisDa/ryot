import type { RouteConfig } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";
import { requireAuth } from "~/auth/middleware";

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

export const createAuthRoute = <TRoute extends RouteConfig>(
	route: TRoute,
): TRoute => {
	return {
		...route,
		middleware: [requireAuth],
		security: [{ "X-Api-Key": [] }],
	};
};
