import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, eq } from "drizzle-orm";
import type { AuthType } from "~/auth";
import { db } from "~/db";
import { entity, entitySchema } from "~/db/schema";
import {
	createAuthRoute,
	errorJsonResponse,
	jsonResponse,
	pathParamValidationErrorResponse,
} from "~/lib/openapi";
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

const entityRoute = createAuthRoute(
	createRoute({
		method: "get",
		tags: ["entities"],
		path: "/{entityId}",
		request: { params: entityParams },
		summary: "Get a single entity by id",
		responses: {
			400: pathParamValidationErrorResponse,
			401: errorJsonResponse("Request is unauthenticated"),
			404: errorJsonResponse("Entity does not exist for this user"),
			200: jsonResponse("Entity was found", foundEntityResponseSchema),
		},
	}),
);

export const entitiesApi = new OpenAPIHono<{ Variables: AuthType }>().openapi(
	entityRoute,
	async (c) => {
		const user = c.get("user");
		const params = c.req.valid("param");

		const [foundEntity] = await db
			.select(entitySelect)
			.from(entity)
			.innerJoin(entitySchema, eq(entity.entitySchemaId, entitySchema.id))
			.where(and(eq(entity.id, params.entityId), eq(entity.userId, user.id)))
			.limit(1);

		if (!foundEntity) return c.json({ error: "Entity not found" }, 404);

		return c.json(
			{
				...foundEntity,
				created_at: foundEntity.created_at.toISOString(),
				updated_at: foundEntity.updated_at.toISOString(),
			},
			200,
		);
	},
);
