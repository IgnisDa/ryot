import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute, validator as zValidator } from "hono-openapi";
import { z } from "zod";
import type { AuthType } from "~/auth";
import { db } from "~/db";
import { entity, entitySchema } from "~/db/schema";
import {
	errorJsonResponse,
	jsonResponse,
	pathParamValidationErrorResponse,
	protectedRouteSpec,
} from "~/lib/openapi";
import { errorResponse, successResponse } from "~/lib/response";
import { nonEmptyTrimmedStringSchema } from "~/lib/zod/base";

const entityParams = z.object({
	entityId: nonEmptyTrimmedStringSchema,
});

const entitySelect = {
	id: entity.id,
	name: entity.name,
	created_at: entity.createdAt,
	updated_at: entity.updatedAt,
	properties: entity.properties,
	schema_slug: entitySchema.slug,
	external_id: entity.externalId,
	details_script_id: entity.detailsSandboxScriptId,
};

const foundEntityResponseSchema = z.object({
	id: z.string(),
	name: z.string(),
	properties: z.unknown(),
	created_at: z.string(),
	updated_at: z.string(),
	schema_slug: z.string(),
	external_id: z.string(),
	details_script_id: z.string(),
});

export const entitiesApi = new Hono<{ Variables: AuthType }>().get(
	"/:entityId",
	describeRoute(
		protectedRouteSpec({
			tags: ["entities"],
			summary: "Get a single entity by id",
			responses: {
				400: pathParamValidationErrorResponse,
				404: errorJsonResponse("Entity does not exist for this user"),
				200: jsonResponse("Entity was found", foundEntityResponseSchema),
			},
		}),
	),
	zValidator("param", entityParams),
	async (c) => {
		const user = c.get("user");
		const params = c.req.valid("param");

		const [foundEntity] = await db
			.select(entitySelect)
			.from(entity)
			.innerJoin(entitySchema, eq(entity.entitySchemaId, entitySchema.id))
			.where(and(eq(entity.id, params.entityId), eq(entity.userId, user.id)))
			.limit(1);

		if (!foundEntity) return errorResponse(c, "Entity not found", 404);

		return successResponse(c, foundEntity);
	},
);
