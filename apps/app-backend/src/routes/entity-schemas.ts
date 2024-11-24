import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { fromJSONSchema, z } from "zod";
import type { AuthType } from "../auth";
import { db } from "../db";
import { entity, entitySchema, sandboxScript } from "../db/schema";
import { schemaSearchResponse } from "../entity-schema-search";
import { getSandboxService } from "../sandbox";
import { getConfigValue } from "../sandbox/host-functions";

const searchScriptSlug = z.string().trim().min(1);

const schemaSearchBody = z.object({
	page: z.number().int().min(1).default(1),
	query: z.string().trim().min(1),
	search_script_slug: searchScriptSlug,
});

const schemaImportBody = z.object({
	identifier: z.string().trim().min(1),
	search_script_slug: searchScriptSlug,
});

const importEnvelope = z
	.object({
		name: z.string(),
		properties: z.unknown(),
		external_ids: z.object({ openlibrary_work: z.string() }).strict(),
	})
	.strict();

type ParsedImportPayload = {
	name: string;
	properties: Record<string, unknown>;
	external_ids: { openlibrary_work: string };
};

const upsertImportedEntity = async (input: {
	userId: string;
	schemaId: string;
	payload: ParsedImportPayload;
}) => {
	const externalWorkId = input.payload.external_ids.openlibrary_work;

	return db.transaction(async (tx) => {
		const [existingEntity] = await tx
			.select({ id: entity.id })
			.from(entity)
			.where(
				and(
					eq(entity.schemaId, input.schemaId),
					eq(entity.userId, input.userId),
					sql`${entity.externalIds} ->> 'openlibrary_work' = ${externalWorkId}`,
				),
			)
			.orderBy(asc(entity.createdAt))
			.limit(1);

		const values = {
			userId: input.userId,
			name: input.payload.name,
			schemaId: input.schemaId,
			properties: input.payload.properties,
			externalIds: input.payload.external_ids,
		};

		if (existingEntity) {
			await tx
				.update(entity)
				.set(values)
				.where(eq(entity.id, existingEntity.id));
			return { created: false, entityId: existingEntity.id };
		}

		const [createdEntity] = await tx
			.insert(entity)
			.values(values)
			.returning({ id: entity.id });

		if (!createdEntity) throw new Error("Could not persist imported entity");

		return { created: true, entityId: createdEntity.id };
	});
};
const getSearchScriptCode = async (scriptSlug: string, userId: string) => {
	const [userOwned] = await db
		.select({
			code: sandboxScript.code,
			schemaId: entitySchema.id,
			schemaSlug: entitySchema.slug,
			propertiesSchema: entitySchema.propertiesSchema,
		})
		.from(sandboxScript)
		.innerJoin(
			entitySchema,
			eq(entitySchema.id, sandboxScript.searchForEntitySchemaId),
		)
		.where(
			and(eq(sandboxScript.slug, scriptSlug), eq(sandboxScript.userId, userId)),
		)
		.orderBy(asc(sandboxScript.createdAt))
		.limit(1);

	if (userOwned) return userOwned;

	const [builtin] = await db
		.select({
			code: sandboxScript.code,
			schemaId: entitySchema.id,
			schemaSlug: entitySchema.slug,
			propertiesSchema: entitySchema.propertiesSchema,
		})
		.from(sandboxScript)
		.innerJoin(
			entitySchema,
			eq(entitySchema.id, sandboxScript.searchForEntitySchemaId),
		)
		.where(
			and(eq(sandboxScript.slug, scriptSlug), isNull(sandboxScript.userId)),
		)
		.orderBy(asc(sandboxScript.createdAt))
		.limit(1);

	return builtin;
};

const getDetailsScriptCode = async (schemaId: string, userId: string) => {
	const [userOwned] = await db
		.select({ code: sandboxScript.code })
		.from(sandboxScript)
		.where(
			and(
				eq(sandboxScript.userId, userId),
				eq(sandboxScript.detailsForEntitySchemaId, schemaId),
			),
		)
		.orderBy(asc(sandboxScript.createdAt))
		.limit(1);

	if (userOwned) return userOwned;

	const [builtin] = await db
		.select({ code: sandboxScript.code })
		.from(sandboxScript)
		.where(
			and(
				isNull(sandboxScript.userId),
				eq(sandboxScript.detailsForEntitySchemaId, schemaId),
			),
		)
		.orderBy(asc(sandboxScript.createdAt))
		.limit(1);

	return builtin;
};

export const entitySchemasApi = new Hono<{ Variables: AuthType }>()
	.post("/search", zValidator("json", schemaSearchBody), async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");

		const script = await getSearchScriptCode(body.search_script_slug, user.id);
		if (!script) return c.json({ error: "Search script not found" }, 404);

		const sandbox = getSandboxService();
		const result = await sandbox.run({
			code: script.code,
			apiFunctions: { getConfigValue },
			context: {
				page: body.page,
				query: body.query,
				schemaSlug: script.schemaSlug,
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
	})
	.post("/import", zValidator("json", schemaImportBody), async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");

		const searchScript = await getSearchScriptCode(
			body.search_script_slug,
			user.id,
		);
		if (!searchScript) return c.json({ error: "Search script not found" }, 404);

		const script = await getDetailsScriptCode(searchScript.schemaId, user.id);
		if (!script)
			return c.json({ error: "Entity schema import is not configured" }, 400);

		const sandbox = getSandboxService();
		const result = await sandbox.run({
			code: script.code,
			apiFunctions: { getConfigValue },
			context: {
				identifier: body.identifier,
				schemaSlug: searchScript.schemaSlug,
			},
		});

		if (!result.success) {
			if (result.error?.toLowerCase().includes("timed out"))
				return c.json({ error: "Import job timed out" }, 504);

			let errorMessage = "Import script execution failed";
			if (result.error) errorMessage = `${errorMessage}: ${result.error}`;
			if (result.logs) errorMessage = `${errorMessage}\n${result.logs}`;
			return c.json({ error: errorMessage }, 500);
		}

		const parsedEnvelope = importEnvelope.safeParse(result.value);
		if (!parsedEnvelope.success)
			return c.json({ error: "Import script returned invalid payload" }, 500);

		const propertiesParser = (() => {
			try {
				return fromJSONSchema(
					searchScript.propertiesSchema as Parameters<typeof fromJSONSchema>[0],
				);
			} catch {
				return null;
			}
		})();
		if (!propertiesParser)
			return c.json(
				{ error: "Entity schema properties schema is invalid" },
				500,
			);

		const parsedProperties = propertiesParser.safeParse(
			parsedEnvelope.data.properties,
		);
		if (!parsedProperties.success)
			return c.json({ error: "Import script returned invalid payload" }, 500);

		const properties = parsedProperties.data;
		if (
			typeof properties !== "object" ||
			properties === null ||
			Array.isArray(properties)
		)
			return c.json({ error: "Import script returned invalid payload" }, 500);

		const parsedResult: ParsedImportPayload = {
			name: parsedEnvelope.data.name,
			external_ids: parsedEnvelope.data.external_ids,
			properties: properties as Record<string, unknown>,
		};

		try {
			const persistedEntity = await upsertImportedEntity({
				userId: user.id,
				schemaId: searchScript.schemaId,
				payload: parsedResult,
			});

			return c.json({
				entity_id: persistedEntity.entityId,
				created: persistedEntity.created,
			});
		} catch (error) {
			let errorMessage = "Import persistence failed";
			if (error instanceof Error)
				errorMessage = `${errorMessage}: ${error.message}`;
			return c.json({ error: errorMessage }, 500);
		}
	});
