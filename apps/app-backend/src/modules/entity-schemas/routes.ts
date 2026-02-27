import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AuthType } from "~/auth";
import {
	createAuthRoute,
	dataSchema,
	ERROR_CODES,
	errorJsonResponse,
	errorResponse,
	jsonResponse,
	payloadValidationErrorResponse,
	successResponse,
} from "~/lib/openapi";
import { listEntitySchemasByUser } from "./repository";
import {
	schemaImportBody,
	schemaSearchBody,
	schemaSearchResponse,
} from "./schemas";
import { runSchemaImport, runSchemaSearch } from "./service";

const scriptPairSchema = z.object({
	searchScriptId: z.string(),
	detailsScriptId: z.string(),
	searchScriptName: z.string(),
	detailsScriptName: z.string(),
});

const listedEntitySchema = z.object({
	id: z.string(),
	slug: z.string(),
	name: z.string(),
	scriptPairs: z.array(scriptPairSchema),
});

const listEntitySchemasResponseSchema = dataSchema(z.array(listedEntitySchema));

const schemaImportResponseSchema = dataSchema(
	z.object({
		created: z.boolean(),
		entityId: z.string(),
	}),
);

const listEntitySchemasRoute = createAuthRoute(
	createRoute({
		path: "/list",
		method: "get",
		tags: ["entity-schemas"],
		summary: "List available entity schemas",
		responses: {
			401: errorJsonResponse(
				"Request is unauthenticated",
				ERROR_CODES.UNAUTHENTICATED,
			),
			200: jsonResponse(
				"Schemas available for the user",
				listEntitySchemasResponseSchema,
			),
		},
	}),
);

const searchEntitySchemasRoute = createAuthRoute(
	createRoute({
		method: "post",
		path: "/search",
		tags: ["entity-schemas"],
		summary: "Search entities for a schema",
		request: {
			body: { content: { "application/json": { schema: schemaSearchBody } } },
		},
		responses: {
			400: payloadValidationErrorResponse,
			401: errorJsonResponse(
				"Request is unauthenticated",
				ERROR_CODES.UNAUTHENTICATED,
			),
			404: errorJsonResponse("Search script is missing", ERROR_CODES.NOT_FOUND),
			500: errorJsonResponse(
				"Search execution or payload parsing failed",
				ERROR_CODES.INTERNAL_ERROR,
			),
			504: errorJsonResponse(
				"Search sandbox job timed out",
				ERROR_CODES.TIMEOUT,
			),
			200: jsonResponse(
				"Search results for the schema query",
				schemaSearchResponse,
			),
		},
	}),
);

const importEntitySchemasRoute = createAuthRoute(
	createRoute({
		path: "/import",
		method: "post",
		tags: ["entity-schemas"],
		summary: "Import an entity from schema scripts",
		request: {
			body: { content: { "application/json": { schema: schemaImportBody } } },
		},
		responses: {
			400: payloadValidationErrorResponse,
			401: errorJsonResponse(
				"Request is unauthenticated",
				ERROR_CODES.UNAUTHENTICATED,
			),
			404: errorJsonResponse(
				"Details script is missing",
				ERROR_CODES.NOT_FOUND,
			),
			500: errorJsonResponse(
				"Import execution or persistence failed",
				ERROR_CODES.INTERNAL_ERROR,
			),
			504: errorJsonResponse(
				"Import sandbox job timed out",
				ERROR_CODES.TIMEOUT,
			),
			200: jsonResponse("Entity import persisted", schemaImportResponseSchema),
		},
	}),
);

export const entitySchemasApi = new OpenAPIHono<{ Variables: AuthType }>()
	.openapi(listEntitySchemasRoute, async (c) => {
		const user = c.get("user");
		const schemas = await listEntitySchemasByUser(user.id);
		return c.json(successResponse(schemas), 200);
	})
	.openapi(searchEntitySchemasRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");
		const result = await runSchemaSearch({ userId: user.id, body });

		if (!result.success) {
			if (result.status === 404)
				return c.json(errorResponse(ERROR_CODES.NOT_FOUND, result.error), 404);
			if (result.status === 504)
				return c.json(errorResponse(ERROR_CODES.TIMEOUT, result.error), 504);
			return c.json(
				errorResponse(ERROR_CODES.INTERNAL_ERROR, result.error),
				500,
			);
		}

		return c.json(result.data, 200);
	})
	.openapi(importEntitySchemasRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");
		const result = await runSchemaImport({ userId: user.id, body });

		if (!result.success) {
			if (result.status === 404)
				return c.json(errorResponse(ERROR_CODES.NOT_FOUND, result.error), 404);
			if (result.status === 504)
				return c.json(errorResponse(ERROR_CODES.TIMEOUT, result.error), 504);
			return c.json(
				errorResponse(ERROR_CODES.INTERNAL_ERROR, result.error),
				500,
			);
		}

		return c.json(successResponse(result.data), 200);
	});
