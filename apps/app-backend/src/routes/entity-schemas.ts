import { zValidator } from "@hono/zod-validator";
import { and, eq, isNull, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthType } from "../auth";
import { db } from "../db";
import { entitySchema, sandboxScript } from "../db/schema";
import {
	entitySchemaSearchJobName,
	entitySchemaSearchJobWaitTimeoutMs,
	schemaSearchResponse,
} from "../entity-schema-search";
import { getQueues } from "../queue";

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

		const queues = getQueues();
		const job = await queues.sandboxScriptQueue.add(entitySchemaSearchJobName, {
			page: body.page,
			query: body.query,
			scriptCode: script.code,
			schemaSlug: params.schemaSlug,
		});

		if (!job.id) return c.json({ error: "Could not create search job" }, 500);

		try {
			const result = await job.waitUntilFinished(
				queues.sandboxScriptQueueEvents,
				entitySchemaSearchJobWaitTimeoutMs,
			);
			const parsedResult = schemaSearchResponse.safeParse(result);
			if (!parsedResult.success)
				return c.json({ error: "Search script returned invalid payload" }, 500);

			return c.json(parsedResult.data);
		} catch (error) {
			if (
				error instanceof Error &&
				error.message.toLowerCase().includes("timed out")
			)
				return c.json({ error: "Search job timed out" }, 504);

			if (error instanceof Error) return c.json({ error: error.message }, 500);

			return c.json({ error: "Search job failed" }, 500);
		}
	},
);
