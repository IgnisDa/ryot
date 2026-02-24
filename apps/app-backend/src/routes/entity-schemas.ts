import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { fromJSONSchema, z } from "zod";
import type { AuthType } from "../auth";
import { db } from "../db";
import { entity, entitySchema, sandboxScript } from "../db/schema";
import { schemaSearchResponse } from "../entity-schema-search";
import { getSandboxService } from "../sandbox";

const schemaParams = z.object({
	schemaSlug: z.string().trim().min(1),
});

const schemaSearchBody = z.object({
	query: z.string().trim().min(1),
	page: z.number().int().min(1).default(1),
});

const schemaImportBody = z.object({
	identifier: z.string().trim().min(1),
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

const getSchemaBySlug = async (schemaSlug: string, userId: string) => {
	const [userOwned] = await db
		.select({
			id: entitySchema.id,
			slug: entitySchema.slug,
			propertiesSchema: entitySchema.propertiesSchema,
			searchSandboxScriptId: entitySchema.searchSandboxScriptId,
			detailsSandboxScriptId: entitySchema.detailsSandboxScriptId,
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
			propertiesSchema: entitySchema.propertiesSchema,
			searchSandboxScriptId: entitySchema.searchSandboxScriptId,
			detailsSandboxScriptId: entitySchema.detailsSandboxScriptId,
		})
		.from(entitySchema)
		.where(and(eq(entitySchema.slug, schemaSlug), isNull(entitySchema.userId)))
		.limit(1);

	return builtin;
};

const getScriptCode = async (scriptId: string, userId: string) => {
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

export const entitySchemasApi = new Hono<{ Variables: AuthType }>()
	.post(
		"/:schemaSlug/search",
		zValidator("param", schemaParams),
		zValidator("json", schemaSearchBody),
		async (c) => {
			const user = c.get("user");
			const body = c.req.valid("json");
			const params = c.req.valid("param");

			const schema = await getSchemaBySlug(params.schemaSlug, user.id);
			if (!schema) return c.json({ error: "Entity schema not found" }, 404);
			if (!schema.searchSandboxScriptId)
				return c.json({ error: "Entity schema search is not configured" }, 400);

			const script = await getScriptCode(schema.searchSandboxScriptId, user.id);
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
	)
	.post(
		"/:schemaSlug/import",
		zValidator("param", schemaParams),
		zValidator("json", schemaImportBody),
		async (c) => {
			const user = c.get("user");
			const body = c.req.valid("json");
			const params = c.req.valid("param");

			const schema = await getSchemaBySlug(params.schemaSlug, user.id);
			if (!schema) return c.json({ error: "Entity schema not found" }, 404);
			if (!schema.detailsSandboxScriptId)
				return c.json({ error: "Entity schema import is not configured" }, 400);

			const script = await getScriptCode(
				schema.detailsSandboxScriptId,
				user.id,
			);
			if (!script) return c.json({ error: "Import script not found" }, 404);

			const sandbox = getSandboxService();
			const result = await sandbox.run({
				code: script.code,
				context: { identifier: body.identifier, schemaSlug: params.schemaSlug },
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
						schema.propertiesSchema as Parameters<typeof fromJSONSchema>[0],
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
					schemaId: schema.id,
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
		},
	);
