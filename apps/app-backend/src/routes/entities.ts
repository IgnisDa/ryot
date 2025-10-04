import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthType } from "../auth";
import { db } from "../db";
import { entity, entitySchema } from "../db/schema";
import { errorResponse, successResponse } from "../lib/response";
import { nonEmptyTrimmedStringSchema } from "../lib/zod/base";

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
	external_ids: entity.externalIds,
};

export const entitiesApi = new Hono<{ Variables: AuthType }>().get(
	"/:entityId",
	zValidator("param", entityParams),
	async (c) => {
		const user = c.get("user");
		const params = c.req.valid("param");

		const [foundEntity] = await db
			.select(entitySelect)
			.from(entity)
			.innerJoin(entitySchema, eq(entity.schemaId, entitySchema.id))
			.where(and(eq(entity.id, params.entityId), eq(entity.userId, user.id)))
			.limit(1);

		if (!foundEntity) return errorResponse(c, "Entity not found", 404);

		return successResponse(c, foundEntity);
	},
);
