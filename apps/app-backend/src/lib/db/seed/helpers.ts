import { generateId } from "better-auth";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "~/lib/db";
import {
	EntitySchemaSandboxScriptKind,
	entitySchema,
	entitySchemaSandboxScript,
	eventSchema,
	sandboxScript,
} from "~/lib/db/schema";

export const ensureBuiltinEntitySchema = async (input: {
	slug: string;
	name: string;
	icon: string;
	accentColor: string;
	propertiesSchema: unknown;
}) => {
	const [existing] = await db
		.select({ id: entitySchema.id })
		.from(entitySchema)
		.where(and(eq(entitySchema.slug, input.slug), isNull(entitySchema.userId)))
		.limit(1);

	const schemaId = existing?.id ?? generateId();

	const values = {
		isBuiltin: true,
		name: input.name,
		slug: input.slug,
		icon: input.icon,
		accentColor: input.accentColor,
		propertiesSchema: input.propertiesSchema,
	};

	if (existing)
		await db
			.update(entitySchema)
			.set(values)
			.where(eq(entitySchema.id, schemaId));
	else await db.insert(entitySchema).values({ id: schemaId, ...values });

	return schemaId;
};

export const ensureBuiltinEntitySchemaEventSchemas = async (input: {
	entitySchemaId: string;
	eventSchemas: Array<{
		slug: string;
		name: string;
		propertiesSchema: unknown;
	}>;
}) => {
	await db
		.delete(eventSchema)
		.where(eq(eventSchema.entitySchemaId, input.entitySchemaId));

	if (!input.eventSchemas.length) return;

	await db.insert(eventSchema).values(
		input.eventSchemas.map((schema) => ({
			slug: schema.slug,
			name: schema.name,
			entitySchemaId: input.entitySchemaId,
			propertiesSchema: schema.propertiesSchema,
		})),
	);
};

export const ensureBuiltinSandboxScript = async (input: {
	code: string;
	name: string;
	slug: string;
}) => {
	const [existingScript] = await db
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

		if (shouldUpdateScript)
			await db
				.update(sandboxScript)
				.set(values)
				.where(eq(sandboxScript.id, scriptId));
	} else {
		await db
			.insert(sandboxScript)
			.values({ id: scriptId, slug: input.slug, ...values });
	}

	return scriptId;
};

const ensureScriptLinkToEntitySchema = async (input: {
	entitySchemaId: string;
	sandboxScriptId: string;
	kind: EntitySchemaSandboxScriptKind;
}) => {
	const [existing] = await db
		.select({ id: entitySchemaSandboxScript.id })
		.from(entitySchemaSandboxScript)
		.where(
			and(
				eq(entitySchemaSandboxScript.entitySchemaId, input.entitySchemaId),
				eq(entitySchemaSandboxScript.kind, input.kind),
				eq(entitySchemaSandboxScript.sandboxScriptId, input.sandboxScriptId),
			),
		)
		.limit(1);

	if (existing) return;

	await db.insert(entitySchemaSandboxScript).values({
		kind: input.kind,
		entitySchemaId: input.entitySchemaId,
		sandboxScriptId: input.sandboxScriptId,
	});
};

export const linkScriptPairToEntitySchema = async (input: {
	entitySchemaId: string;
	searchScriptId: string;
	detailsScriptId: string;
}) => {
	await ensureScriptLinkToEntitySchema({
		entitySchemaId: input.entitySchemaId,
		sandboxScriptId: input.searchScriptId,
		kind: EntitySchemaSandboxScriptKind.search,
	});
	await ensureScriptLinkToEntitySchema({
		entitySchemaId: input.entitySchemaId,
		sandboxScriptId: input.detailsScriptId,
		kind: EntitySchemaSandboxScriptKind.details,
	});
};
