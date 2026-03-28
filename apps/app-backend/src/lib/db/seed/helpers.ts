import { generateId } from "better-auth";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import type { DbClient } from "~/lib/db";
import {
	entitySchema,
	entitySchemaSandboxScript,
	eventSchema,
	sandboxScript,
} from "~/lib/db/schema";

export const ensureBuiltinEntitySchema = async (input: {
	slug: string;
	name: string;
	icon: string;
	database: DbClient;
	accentColor: string;
	propertiesSchema: unknown;
}) => {
	const [existing] = await input.database
		.select({ id: entitySchema.id })
		.from(entitySchema)
		.where(and(eq(entitySchema.slug, input.slug), isNull(entitySchema.userId)))
		.limit(1);

	if (existing) {
		return existing.id;
	}

	const schemaId = generateId();
	await input.database.insert(entitySchema).values({
		id: schemaId,
		isBuiltin: true,
		name: input.name,
		slug: input.slug,
		icon: input.icon,
		accentColor: input.accentColor,
		propertiesSchema: input.propertiesSchema,
	});

	return schemaId;
};

export const ensureBuiltinEntitySchemaEventSchemas = async (input: {
	database: DbClient;
	entitySchemaId: string;
	eventSchemas: Array<{
		slug: string;
		name: string;
		propertiesSchema: unknown;
	}>;
}) => {
	const expectedSlugs = input.eventSchemas.map((schema) => schema.slug);

	if (expectedSlugs.length === 0) {
		await input.database
			.delete(eventSchema)
			.where(
				and(
					eq(eventSchema.entitySchemaId, input.entitySchemaId),
					isNull(eventSchema.userId),
				),
			);
	} else {
		await input.database
			.delete(eventSchema)
			.where(
				and(
					eq(eventSchema.entitySchemaId, input.entitySchemaId),
					isNull(eventSchema.userId),
					notInArray(eventSchema.slug, expectedSlugs),
				),
			);
	}

	for (const schema of input.eventSchemas) {
		await input.database.execute(sql`
			insert into "event_schema" (
				"id",
				"slug",
				"name",
				"entity_schema_id",
				"properties_schema",
				"is_builtin"
			)
			values (
				${generateId()},
				${schema.slug},
				${schema.name},
				${input.entitySchemaId},
				${JSON.stringify(schema.propertiesSchema)}::jsonb,
				true
			)
			on conflict ("entity_schema_id", "slug")
			where "user_id" is null
			do update set
				"name" = excluded."name",
				"is_builtin" = true,
				"properties_schema" = excluded."properties_schema"
		`);
	}
};

export const ensureBuiltinSandboxScript = async (input: {
	code: string;
	name: string;
	slug: string;
	database: DbClient;
}) => {
	const [existingScript] = await input.database
		.select({
			id: sandboxScript.id,
			code: sandboxScript.code,
			name: sandboxScript.name,
			isBuiltin: sandboxScript.isBuiltin,
		})
		.from(sandboxScript)
		.where(
			and(eq(sandboxScript.slug, input.slug), isNull(sandboxScript.userId)),
		)
		.limit(1);

	const scriptId = existingScript?.id ?? generateId();
	const values = { code: input.code, name: input.name, isBuiltin: true };

	if (existingScript) {
		const shouldUpdateScript =
			existingScript.code !== input.code ||
			existingScript.name !== input.name ||
			!existingScript.isBuiltin;

		if (shouldUpdateScript) {
			// Builtin sandbox scripts intentionally refresh on every startup so the
			// database always serves the latest bundled code.
			await input.database
				.update(sandboxScript)
				.set(values)
				.where(eq(sandboxScript.id, scriptId));
		}
	} else {
		await input.database
			.insert(sandboxScript)
			.values({ id: scriptId, slug: input.slug, ...values });
	}

	return scriptId;
};

export const linkScriptPairToEntitySchema = async (input: {
	database: DbClient;
	entitySchemaId: string;
	searchScriptId: string;
	detailsScriptId: string;
}) => {
	const [existing] = await input.database
		.select({ id: entitySchemaSandboxScript.id })
		.from(entitySchemaSandboxScript)
		.where(
			and(
				eq(entitySchemaSandboxScript.entitySchemaId, input.entitySchemaId),
				eq(
					entitySchemaSandboxScript.searchSandboxScriptId,
					input.searchScriptId,
				),
				eq(
					entitySchemaSandboxScript.detailsSandboxScriptId,
					input.detailsScriptId,
				),
			),
		)
		.limit(1);

	if (existing) {
		return;
	}

	await input.database.insert(entitySchemaSandboxScript).values({
		entitySchemaId: input.entitySchemaId,
		searchSandboxScriptId: input.searchScriptId,
		detailsSandboxScriptId: input.detailsScriptId,
	});
};
