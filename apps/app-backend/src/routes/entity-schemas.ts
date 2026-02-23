import { zValidator } from "@hono/zod-validator";
import { and, eq, isNull, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthType } from "../auth";
import { db } from "../db";
import { entitySchema, sandboxScript } from "../db/schema";
import { getSandboxService } from "../sandbox";

const schemaSearchParams = z.object({
	schemaSlug: z.string().trim().min(1),
});

const schemaSearchBody = z.object({
	query: z.string().trim().min(1),
	page: z.number().int().min(1).default(1),
});

const schemaSearchResponse = z.object({
	details: z.object({
		next_page: z.number().int().min(1).nullable(),
		total_items: z.number().int().nonnegative(),
	}),
	items: z.array(
		z.object({
			title: z.string(),
			identifier: z.string(),
			image: z.string().nullable().optional(),
			publish_year: z.number().int().nullable().optional(),
		}),
	),
});

const getSchemaBySlug = async (schemaSlug: string, userId: string) => {
	const [userOwned] = await db
		.select({
			id: entitySchema.id,
			slug: entitySchema.slug,
			searchSandboxScriptId: entitySchema.searchSandboxScriptId,
		})
		.from(entitySchema)
		.where(
			and(eq(entitySchema.slug, schemaSlug), eq(entitySchema.userId, userId)),
		)
		.limit(1);

	if (userOwned) return userOwned;

	const [builtin] = await db
		.select({
			id: entitySchema.id,
			slug: entitySchema.slug,
			searchSandboxScriptId: entitySchema.searchSandboxScriptId,
		})
		.from(entitySchema)
		.where(and(eq(entitySchema.slug, schemaSlug), isNull(entitySchema.userId)))
		.limit(1);

	return builtin;
};

export const entitySchemasApi = new Hono<{ Variables: AuthType }>().post(
	"/:schemaSlug/search",
	zValidator("param", schemaSearchParams),
	zValidator("json", schemaSearchBody),
	async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");
		const params = c.req.valid("param");

		const schema = await getSchemaBySlug(params.schemaSlug, user.id);
		if (!schema) return c.json({ error: "Entity schema not found" }, 404);
		if (!schema.searchSandboxScriptId)
			return c.json({ error: "Entity schema search is not configured" }, 400);

		const [script] = await db
			.select({ code: sandboxScript.code })
			.from(sandboxScript)
			.where(
				and(
					eq(sandboxScript.id, schema.searchSandboxScriptId),
					or(eq(sandboxScript.userId, user.id), isNull(sandboxScript.userId)),
				),
			)
			.limit(1);

		if (!script) return c.json({ error: "Search script not found" }, 404);

		const sandbox = getSandboxService();
		const result = await sandbox.run({
			code: script.code,
			apiFunctions: {},
			context: {
				page: body.page,
				query: body.query,
				schemaSlug: params.schemaSlug,
			},
		});

		if (!result.success)
			return c.json(
				{
					logs: result.logs,
					details: result.error,
					error: "Search script execution failed",
				},
				500,
			);

		try {
			const parsed = schemaSearchResponse.parse(result.value);
			return c.json(parsed);
		} catch (error) {
			if (error instanceof z.ZodError)
				return c.json(
					{
						details: error.issues,
						error: "Search script returned invalid payload",
					},
					500,
				);

			return c.json({ error: "Search script response validation failed" }, 500);
		}
	},
);
