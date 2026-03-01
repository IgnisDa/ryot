import { and, asc, eq, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "~/db";
import {
	entity,
	entitySchema,
	entitySchemaSandboxScript,
	sandboxScript,
} from "~/db/schema";
import type { ParsedImportPayload } from "./schemas";

export const listEntitySchemasByUser = async (userId: string) => {
	const detailsSandboxScript = alias(sandboxScript, "details_sandbox_script");
	const searchSandboxScript = alias(sandboxScript, "search_sandbox_script");

	const rows = await db
		.select({
			id: entitySchema.id,
			slug: entitySchema.slug,
			name: entitySchema.name,
			searchScriptName: searchSandboxScript.name,
			detailsScriptName: detailsSandboxScript.name,
			searchScriptId: entitySchemaSandboxScript.searchSandboxScriptId,
			detailsScriptId: entitySchemaSandboxScript.detailsSandboxScriptId,
		})
		.from(entitySchema)
		.innerJoin(
			entitySchemaSandboxScript,
			eq(entitySchemaSandboxScript.entitySchemaId, entitySchema.id),
		)
		.innerJoin(
			detailsSandboxScript,
			eq(
				detailsSandboxScript.id,
				entitySchemaSandboxScript.detailsSandboxScriptId,
			),
		)
		.innerJoin(
			searchSandboxScript,
			eq(
				searchSandboxScript.id,
				entitySchemaSandboxScript.searchSandboxScriptId,
			),
		)
		.where(
			or(
				and(
					isNull(entitySchema.userId),
					isNull(detailsSandboxScript.userId),
					isNull(searchSandboxScript.userId),
				),
				and(
					eq(entitySchema.userId, userId),
					eq(detailsSandboxScript.userId, userId),
					eq(searchSandboxScript.userId, userId),
				),
			),
		)
		.orderBy(
			asc(entitySchema.name),
			asc(searchSandboxScript.name),
			asc(detailsSandboxScript.name),
		);

	const groupedSchemas = rows.reduce(
		(acc, row) => {
			if (!acc[row.id]) {
				acc[row.id] = {
					id: row.id,
					slug: row.slug,
					name: row.name,
					scriptPairs: [],
				};
			}

			acc[row.id].scriptPairs.push({
				searchScriptId: row.searchScriptId,
				detailsScriptId: row.detailsScriptId,
				searchScriptName: row.searchScriptName,
				detailsScriptName: row.detailsScriptName,
			});

			return acc;
		},
		{} as Record<
			string,
			{
				id: string;
				slug: string;
				name: string;
				scriptPairs: Array<{
					searchScriptId: string;
					detailsScriptId: string;
					searchScriptName: string;
					detailsScriptName: string;
				}>;
			}
		>,
	);

	return Object.values(groupedSchemas);
};

export const getScriptById = async (scriptId: string) => {
	const [script] = await db
		.select({
			id: sandboxScript.id,
			code: sandboxScript.code,
			schemaId: entitySchema.id,
			schemaSlug: entitySchema.slug,
			propertiesSchema: entitySchema.propertiesSchema,
		})
		.from(sandboxScript)
		.innerJoin(
			entitySchemaSandboxScript,
			or(
				eq(entitySchemaSandboxScript.searchSandboxScriptId, sandboxScript.id),
				eq(entitySchemaSandboxScript.detailsSandboxScriptId, sandboxScript.id),
			),
		)
		.innerJoin(
			entitySchema,
			eq(entitySchema.id, entitySchemaSandboxScript.entitySchemaId),
		)
		.where(eq(sandboxScript.id, scriptId))
		.limit(1);

	return script;
};

export const upsertImportedEntity = async (input: {
	userId: string;
	entitySchemaId: string;
	payload: ParsedImportPayload;
	detailsSandboxScriptId: string;
}) => {
	return db.transaction(async (tx) => {
		const [existingEntity] = await tx
			.select({ id: entity.id })
			.from(entity)
			.where(
				and(
					eq(entity.entitySchemaId, input.entitySchemaId),
					eq(entity.userId, input.userId),
					eq(entity.externalId, input.payload.external_id),
					eq(entity.detailsSandboxScriptId, input.detailsSandboxScriptId),
				),
			)
			.orderBy(asc(entity.createdAt))
			.limit(1)
			.for("update");

		const values = {
			userId: input.userId,
			name: input.payload.name,
			properties: input.payload.properties,
			entitySchemaId: input.entitySchemaId,
			externalId: input.payload.external_id,
			detailsSandboxScriptId: input.detailsSandboxScriptId,
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
