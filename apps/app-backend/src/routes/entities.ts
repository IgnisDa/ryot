import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthType } from "../auth";
import { db } from "../db";
import { entity, entitySchema } from "../db/schema";

const entityParams = z.object({
	entityId: z.string().trim().min(1),
});

const entitiesQuery = z.object({
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(100).default(20),
	schema_slug: z.string().trim().min(1).optional(),
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

export const entitiesApi = new Hono<{ Variables: AuthType }>()
	.get("/:entityId", zValidator("param", entityParams), async (c) => {
		const user = c.get("user");
		const params = c.req.valid("param");

		const [foundEntity] = await db
			.select(entitySelect)
			.from(entity)
			.innerJoin(entitySchema, eq(entity.schemaId, entitySchema.id))
			.where(and(eq(entity.id, params.entityId), eq(entity.userId, user.id)))
			.limit(1);

		if (!foundEntity) return c.json({ error: "Entity not found" }, 404);

		return c.json(foundEntity);
	})
	.get("/", zValidator("query", entitiesQuery), async (c) => {
		const user = c.get("user");
		const query = c.req.valid("query");

		const whereClause = query.schema_slug
			? and(
					eq(entity.userId, user.id),
					eq(entitySchema.slug, query.schema_slug),
				)
			: eq(entity.userId, user.id);

		const offset = (query.page - 1) * query.limit;

		const [countRow] = await db
			.select({ count: sql<number>`count(*)` })
			.from(entity)
			.innerJoin(entitySchema, eq(entity.schemaId, entitySchema.id))
			.where(whereClause);

		const items = await db
			.select(entitySelect)
			.from(entity)
			.innerJoin(entitySchema, eq(entity.schemaId, entitySchema.id))
			.where(whereClause)
			.orderBy(desc(entity.updatedAt))
			.limit(query.limit)
			.offset(offset);

		return c.json({
			items,
			page: query.page,
			limit: query.limit,
			total_count: Number(countRow?.count ?? 0),
		});
	});
