import { generateId } from "better-auth";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import type { DbClient } from "~/lib/db";
import {
	entitySchema,
	entitySchemaScript,
	eventSchema,
	eventSchemaTrigger,
	relationshipSchema,
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
		await input.database
			.update(entitySchema)
			.set({
				isBuiltin: true,
				name: input.name,
				icon: input.icon,
				accentColor: input.accentColor,
				propertiesSchema: input.propertiesSchema,
			})
			.where(eq(entitySchema.id, existing.id));

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
	metadata: unknown;
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
	const values = {
		isBuiltin: true,
		name: input.name,
		code: input.code,
		metadata: input.metadata,
	};

	if (existingScript) {
		// Builtin sandbox scripts intentionally refresh on every startup so the
		// database always serves the latest bundled code and metadata.
		await input.database
			.update(sandboxScript)
			.set(values)
			.where(eq(sandboxScript.id, scriptId));
	} else {
		await input.database
			.insert(sandboxScript)
			.values({ id: scriptId, slug: input.slug, ...values });
	}

	return scriptId;
};

export const ensureBuiltinRelationshipSchema = async (input: {
	slug: string;
	name: string;
	database: DbClient;
	propertiesSchema: unknown;
	sourceEntitySchemaId?: string;
	targetEntitySchemaId?: string;
}) => {
	const [existing] = await input.database
		.select({ id: relationshipSchema.id })
		.from(relationshipSchema)
		.where(
			and(
				eq(relationshipSchema.slug, input.slug),
				isNull(relationshipSchema.userId),
			),
		)
		.limit(1);

	if (existing) {
		await input.database
			.update(relationshipSchema)
			.set({
				isBuiltin: true,
				name: input.name,
				propertiesSchema: input.propertiesSchema,
				sourceEntitySchemaId: input.sourceEntitySchemaId ?? null,
				targetEntitySchemaId: input.targetEntitySchemaId ?? null,
			})
			.where(eq(relationshipSchema.id, existing.id));

		return existing.id;
	}

	const schemaId = generateId();
	await input.database.insert(relationshipSchema).values({
		id: schemaId,
		isBuiltin: true,
		name: input.name,
		slug: input.slug,
		propertiesSchema: input.propertiesSchema,
		sourceEntitySchemaId: input.sourceEntitySchemaId ?? null,
		targetEntitySchemaId: input.targetEntitySchemaId ?? null,
	});

	return schemaId;
};

export const ensureBuiltinEventSchemaTrigger = async (input: {
	name: string;
	database: DbClient;
	eventSchemaId: string;
	sandboxScriptId: string;
}) => {
	const [existing] = await input.database
		.select({ id: eventSchemaTrigger.id })
		.from(eventSchemaTrigger)
		.where(
			and(
				isNull(eventSchemaTrigger.userId),
				eq(eventSchemaTrigger.eventSchemaId, input.eventSchemaId),
				eq(eventSchemaTrigger.sandboxScriptId, input.sandboxScriptId),
			),
		)
		.limit(1);

	if (existing) {
		await input.database
			.update(eventSchemaTrigger)
			.set({
				isActive: true,
				isBuiltin: true,
				name: input.name,
			})
			.where(eq(eventSchemaTrigger.id, existing.id));

		return existing.id;
	}

	const triggerId = generateId();
	await input.database.insert(eventSchemaTrigger).values({
		id: triggerId,
		isActive: true,
		isBuiltin: true,
		name: input.name,
		eventSchemaId: input.eventSchemaId,
		sandboxScriptId: input.sandboxScriptId,
	});

	return triggerId;
};

export const linkScriptToEntitySchema = async (input: {
	database: DbClient;
	entitySchemaId: string;
	sandboxScriptId: string;
}) => {
	const [existing] = await input.database
		.select({ id: entitySchemaScript.id })
		.from(entitySchemaScript)
		.where(
			and(
				eq(entitySchemaScript.entitySchemaId, input.entitySchemaId),
				eq(entitySchemaScript.sandboxScriptId, input.sandboxScriptId),
			),
		)
		.limit(1);

	if (existing) {
		return;
	}

	await input.database.insert(entitySchemaScript).values({
		entitySchemaId: input.entitySchemaId,
		sandboxScriptId: input.sandboxScriptId,
	});
};
