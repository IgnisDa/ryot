import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { fromJSONSchema, z } from "zod";
import type { AuthType } from "../auth";
import { db } from "../db";
import {
	type EntitySchemaScriptType,
	entity,
	entitySchema,
	entitySchemaSandboxScript,
	sandboxScript,
} from "../db/schema";
import { getSandboxService } from "../sandbox";
import {
	getAppConfigValue,
	getUserConfigValue,
} from "../sandbox/host-functions";

const schemaSearchBody = z.object({
	query: z.string().trim().min(1),
	page: z.number().int().min(1).default(1),
	search_script_id: z.string().trim().min(1),
});

const schemaImportBody = z.object({
	identifier: z.string().trim().min(1),
	details_script_id: z.string().trim().min(1),
});

const importEnvelope = z
	.object({
		name: z.string(),
		properties: z.unknown(),
		external_ids: z
			.record(z.string().trim().min(1), z.string().trim().min(1))
			.refine((value) => Object.keys(value).length > 0),
	})
	.strict();

const schemaSearchResponse = z.object({
	details: z.object({
		total_items: z.number().int().nonnegative(),
		next_page: z.number().int().min(1).nullable(),
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

type ParsedImportPayload = {
	name: string;
	properties: Record<string, unknown>;
	external_ids: Record<string, string>;
};

const handleFailedSandboxResult = (
	c: Context,
	result: { error?: string; logs?: string },
	label: string,
) => {
	if (result.error?.toLowerCase().includes("timed out"))
		return c.json({ error: `${label} job timed out` }, 504);

	let errorMessage = `${label} script execution failed`;
	if (result.error) errorMessage = `${errorMessage}: ${result.error}`;
	if (result.logs) errorMessage = `${errorMessage}\n${result.logs}`;
	return c.json({ error: errorMessage }, 500);
};

const upsertImportedEntity = async (input: {
	userId: string;
	schemaId: string;
	payload: ParsedImportPayload;
}) => {
	const externalIdConditions = Object.entries(input.payload.external_ids).map(
		([idKey, idValue]) => sql`${entity.externalIds} ->> ${idKey} = ${idValue}`,
	);

	const externalIdCondition =
		externalIdConditions.length === 1
			? externalIdConditions[0]
			: or(...externalIdConditions);

	if (!externalIdCondition)
		throw new Error("Imported payload is missing external IDs");

	return db.transaction(async (tx) => {
		const [existingEntity] = await tx
			.select({ id: entity.id })
			.from(entity)
			.where(
				and(
					eq(entity.schemaId, input.schemaId),
					eq(entity.userId, input.userId),
					externalIdCondition,
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

const getScriptById = async (scriptId: string, userId: string) => {
	const [userOwned] = await db
		.select({
			code: sandboxScript.code,
			schemaId: entitySchema.id,
			schemaSlug: entitySchema.slug,
			propertiesSchema: entitySchema.propertiesSchema,
		})
		.from(sandboxScript)
		.innerJoin(
			entitySchemaSandboxScript,
			eq(entitySchemaSandboxScript.sandboxScriptId, sandboxScript.id),
		)
		.innerJoin(
			entitySchema,
			eq(entitySchema.id, entitySchemaSandboxScript.entitySchemaId),
		)
		.where(
			and(eq(sandboxScript.id, scriptId), eq(sandboxScript.userId, userId)),
		)
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
			entitySchemaSandboxScript,
			eq(entitySchemaSandboxScript.sandboxScriptId, sandboxScript.id),
		)
		.innerJoin(
			entitySchema,
			eq(entitySchema.id, entitySchemaSandboxScript.entitySchemaId),
		)
		.where(and(eq(sandboxScript.id, scriptId), isNull(sandboxScript.userId)))
		.limit(1);

	return builtin;
};

export const entitySchemasApi = new Hono<{ Variables: AuthType }>()
	.get("/list", async (c) => {
		const user = c.get("user");

		const schemas = await db
			.select({
				id: entitySchema.id,
				slug: entitySchema.slug,
				name: entitySchema.name,
				scriptId: sandboxScript.id,
				scriptName: sandboxScript.name,
				scriptType: entitySchemaSandboxScript.scriptType,
			})
			.from(entitySchema)
			.innerJoin(
				entitySchemaSandboxScript,
				eq(entitySchemaSandboxScript.entitySchemaId, entitySchema.id),
			)
			.innerJoin(
				sandboxScript,
				eq(sandboxScript.id, entitySchemaSandboxScript.sandboxScriptId),
			)
			.where(
				or(
					and(isNull(entitySchema.userId), isNull(sandboxScript.userId)),
					and(
						eq(entitySchema.userId, user.id),
						eq(sandboxScript.userId, user.id),
					),
				),
			)
			.orderBy(asc(entitySchema.name), asc(sandboxScript.name));

		const groupedSchemas = schemas.reduce(
			(acc, row) => {
				if (!acc[row.id])
					acc[row.id] = {
						id: row.id,
						scripts: [],
						slug: row.slug,
						name: row.name,
					};
				acc[row.id].scripts.push({
					id: row.scriptId,
					name: row.scriptName,
					type: row.scriptType,
				});
				return acc;
			},
			{} as Record<
				string,
				{
					id: string;
					slug: string;
					name: string;
					scripts: Array<{
						id: string;
						name: string;
						type: EntitySchemaScriptType;
					}>;
				}
			>,
		);

		return c.json({ schemas: Object.values(groupedSchemas) });
	})
	.post("/search", zValidator("json", schemaSearchBody), async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");

		const script = await getScriptById(body.search_script_id, user.id);
		if (!script) return c.json({ error: "Search script not found" }, 404);

		const sandbox = getSandboxService();
		const result = await sandbox.run({
			userId: user.id,
			code: script.code,
			apiFunctions: { getAppConfigValue, getUserConfigValue },
			context: {
				pageSize: 20,
				page: body.page,
				query: body.query,
				schemaSlug: script.schemaSlug,
			},
		});
		console.log(result);

		if (!result.success) return handleFailedSandboxResult(c, result, "Search");

		const parsedResult = schemaSearchResponse.safeParse(result.value);
		if (!parsedResult.success)
			return c.json({ error: "Search script returned invalid payload" }, 500);

		return c.json(parsedResult.data);
	})
	.post("/import", zValidator("json", schemaImportBody), async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");

		const script = await getScriptById(body.details_script_id, user.id);
		if (!script) return c.json({ error: "Details script not found" }, 404);

		const sandbox = getSandboxService();
		const result = await sandbox.run({
			userId: user.id,
			code: script.code,
			apiFunctions: { getAppConfigValue, getUserConfigValue },
			context: {
				identifier: body.identifier,
				schemaSlug: script.schemaSlug,
			},
		});

		if (!result.success) return handleFailedSandboxResult(c, result, "Import");

		const parsedEnvelope = importEnvelope.safeParse(result.value);
		if (!parsedEnvelope.success)
			return c.json({ error: "Import script returned invalid payload" }, 500);

		const propertiesParser = (() => {
			try {
				return fromJSONSchema(
					script.propertiesSchema as Parameters<typeof fromJSONSchema>[0],
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
				payload: parsedResult,
				schemaId: script.schemaId,
			});

			return c.json(persistedEntity);
		} catch (error) {
			let errorMessage = "Import persistence failed";
			if (error instanceof Error)
				errorMessage = `${errorMessage}: ${error.message}`;
			return c.json({ error: errorMessage }, 500);
		}
	});
