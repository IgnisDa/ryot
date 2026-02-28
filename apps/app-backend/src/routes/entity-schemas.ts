import { zValidator } from "@hono/zod-validator";
import { and, eq, isNull, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthType } from "../auth";
import { db } from "../db";
import { entitySchema, sandboxScript } from "../db/schema";
import { schemaSearchResponse } from "../entity-schema-search";
import { getSandboxService } from "../sandbox";

const schemaSearchParams = z.object({
	schemaSlug: z.string().trim().min(1),
});

const schemaSearchBody = z.object({
	query: z.string().trim().min(1),
	page: z.number().int().min(1).default(1),
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

const getSearchScriptCode = async (scriptId: string, userId: string) => {
	const [script] = await db
		.select({ code: sandboxScript.code })
		.from(sandboxScript)
		.where(
			and(
				eq(sandboxScript.id, scriptId),
				or(eq(sandboxScript.userId, userId), isNull(sandboxScript.userId)),
			),
		)
		.limit(1);

	return script;
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

		const script = await getSearchScriptCode(
			schema.searchSandboxScriptId,
			user.id,
		);

		if (!script) return c.json({ error: "Search script not found" }, 404);

		const sandbox = getSandboxService();
		const result = await sandbox.run({
			code: script.code,
			context: {
				page: body.page,
				query: body.query,
				schemaSlug: params.schemaSlug,
			},
		});

		if (!result.success) {
			if (result.error?.toLowerCase().includes("timed out"))
				return c.json({ error: "Search job timed out" }, 504);

			let errorMessage = "Search script execution failed";
			if (result.error) errorMessage = `${errorMessage}: ${result.error}`;
			if (result.logs) errorMessage = `${errorMessage}\n${result.logs}`;
			return c.json({ error: errorMessage }, 500);
		}

		const parsedResult = schemaSearchResponse.safeParse(result.value);
		if (!parsedResult.success)
			return c.json({ error: "Search script returned invalid payload" }, 500);

		return c.json(parsedResult.data);
	},
);
