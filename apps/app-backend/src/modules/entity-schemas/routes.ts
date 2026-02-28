import { Hono } from "hono";
import { describeRoute, validator as zValidator } from "hono-openapi";
import { z } from "zod";
import type { AuthType } from "~/auth";
import {
	errorJsonResponse,
	jsonResponse,
	payloadValidationErrorResponse,
	protectedRouteSpec,
} from "~/lib/openapi";
import { errorResponse, successResponse } from "~/lib/response";
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

const listEntitySchemasResponseSchema = z.object({
	schemas: z.array(listedEntitySchema),
});

const schemaImportResponseSchema = z.object({
	created: z.boolean(),
	entityId: z.string(),
});

export const entitySchemasApi = new Hono<{ Variables: AuthType }>()
	.get(
		"/list",
		describeRoute(
			protectedRouteSpec({
				tags: ["entity-schemas"],
				summary: "List available entity schemas",
				responses: {
					200: jsonResponse(
						"Schemas available for the user",
						listEntitySchemasResponseSchema,
					),
				},
			}),
		),
		async (c) => {
			const user = c.get("user");
			const schemas = await listEntitySchemasByUser(user.id);
			return successResponse(c, { schemas });
		},
	)
	.post(
		"/search",
		describeRoute(
			protectedRouteSpec({
				tags: ["entity-schemas"],
				summary: "Search entities for a schema",
				responses: {
					400: payloadValidationErrorResponse,
					404: errorJsonResponse("Search script is missing"),
					504: errorJsonResponse("Search sandbox job timed out"),
					500: errorJsonResponse("Search execution or payload parsing failed"),
					200: jsonResponse(
						"Search results for the schema query",
						schemaSearchResponse,
					),
				},
			}),
		),
		zValidator("json", schemaSearchBody),
		async (c) => {
			const user = c.get("user");
			const body = c.req.valid("json");
			const result = await runSchemaSearch({ userId: user.id, body });

			if (!result.success) return errorResponse(c, result.error, result.status);

			return successResponse(c, result.data);
		},
	)
	.post(
		"/import",
		describeRoute(
			protectedRouteSpec({
				tags: ["entity-schemas"],
				summary: "Import an entity from schema scripts",
				responses: {
					400: payloadValidationErrorResponse,
					404: errorJsonResponse("Details script is missing"),
					504: errorJsonResponse("Import sandbox job timed out"),
					500: errorJsonResponse("Import execution or persistence failed"),
					200: jsonResponse(
						"Entity import persisted",
						schemaImportResponseSchema,
					),
				},
			}),
		),
		zValidator("json", schemaImportBody),
		async (c) => {
			const user = c.get("user");
			const body = c.req.valid("json");
			const result = await runSchemaImport({ userId: user.id, body });

			if (!result.success) return errorResponse(c, result.error, result.status);

			return successResponse(c, result.data);
		},
	);
