import { and, asc, eq, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "~/db";
import {
	EntitySchemaSandboxScriptKind,
	entity,
	entitySchema,
	entitySchemaSandboxScript,
	eventSchema,
	sandboxScript,
} from "~/db/schema";
import type { EventSchema, ParsedImportPayload, ScriptPair } from "./schemas";

export const listEntitySchemasByUser = async (userId: string) => {
	const detailsScriptLink = alias(
		entitySchemaSandboxScript,
		"details_script_link",
	);
	const searchScriptLink = alias(
		entitySchemaSandboxScript,
		"search_script_link",
	);
	const detailsSandboxScript = alias(sandboxScript, "details_sandbox_script");
	const searchSandboxScript = alias(sandboxScript, "search_sandbox_script");

	const rows = await db
		.select({
			id: entitySchema.id,
			slug: entitySchema.slug,
			name: entitySchema.name,
			eventSchemaId: eventSchema.id,
			eventSchemaSlug: eventSchema.slug,
			eventSchemaName: eventSchema.name,
			searchScriptName: searchSandboxScript.name,
			detailsScriptName: detailsSandboxScript.name,
			searchScriptId: searchScriptLink.sandboxScriptId,
			detailsScriptId: detailsScriptLink.sandboxScriptId,
		})
		.from(entitySchema)
		.leftJoin(
			detailsScriptLink,
			and(
				eq(detailsScriptLink.entitySchemaId, entitySchema.id),
				eq(detailsScriptLink.kind, EntitySchemaSandboxScriptKind.details),
			),
		)
		.leftJoin(
			searchScriptLink,
			and(
				eq(searchScriptLink.entitySchemaId, entitySchema.id),
				eq(searchScriptLink.kind, EntitySchemaSandboxScriptKind.search),
			),
		)
		.leftJoin(
			detailsSandboxScript,
			eq(detailsSandboxScript.id, detailsScriptLink.sandboxScriptId),
		)
		.leftJoin(
			searchSandboxScript,
			eq(searchSandboxScript.id, searchScriptLink.sandboxScriptId),
		)
		.leftJoin(eventSchema, eq(eventSchema.entitySchemaId, entitySchema.id))
		.where(
			or(
				and(
					isNull(entitySchema.userId),
					or(
						isNull(detailsSandboxScript.userId),
						isNull(detailsScriptLink.sandboxScriptId),
					),
					or(
						isNull(searchSandboxScript.userId),
						isNull(searchScriptLink.sandboxScriptId),
					),
				),
				and(
					eq(entitySchema.userId, userId),
					or(
						isNull(detailsScriptLink.sandboxScriptId),
						eq(detailsSandboxScript.userId, userId),
					),
					or(
						isNull(searchScriptLink.sandboxScriptId),
						eq(searchSandboxScript.userId, userId),
					),
				),
			),
		)
		.orderBy(asc(entitySchema.name));

	const groupedSchemas = rows.reduce(
		(acc, row) => {
			if (!acc[row.id]) {
				acc[row.id] = {
					id: row.id,
					slug: row.slug,
					name: row.name,
					scriptPairs: [],
					eventSchemas: [],
					seenScriptPairs: new Set<string>(),
					seenEventSchemas: new Set<string>(),
				};
			}

			const schema = acc[row.id];
			if (!schema) return acc;

			if (
				row.searchScriptId &&
				row.detailsScriptId &&
				row.searchScriptName &&
				row.detailsScriptName
			) {
				const scriptPairKey = `${row.searchScriptId}-${row.detailsScriptId}`;

				if (!schema.seenScriptPairs.has(scriptPairKey)) {
					schema.seenScriptPairs.add(scriptPairKey);
					schema.scriptPairs.push({
						searchScriptId: row.searchScriptId,
						detailsScriptId: row.detailsScriptId,
						searchScriptName: row.searchScriptName,
						detailsScriptName: row.detailsScriptName,
					});
				}
			}

			if (
				row.eventSchemaId &&
				row.eventSchemaSlug &&
				row.eventSchemaName &&
				!schema.seenEventSchemas.has(row.eventSchemaId)
			) {
				schema.seenEventSchemas.add(row.eventSchemaId);
				schema.eventSchemas.push({
					id: row.eventSchemaId,
					slug: row.eventSchemaSlug,
					name: row.eventSchemaName,
				});
			}

			return acc;
		},
		{} as Record<
			string,
			{
				id: string;
				slug: string;
				name: string;
				seenScriptPairs: Set<string>;
				seenEventSchemas: Set<string>;
				scriptPairs: Array<ScriptPair>;
				eventSchemas: Array<EventSchema>;
			}
		>,
	);

	return Object.values(groupedSchemas).map(
		({ seenScriptPairs, seenEventSchemas, ...schema }) => schema,
	);
};

export const getScriptById = async (input: {
	kind: EntitySchemaSandboxScriptKind;
	scriptId: string;
}) => {
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
			and(
				eq(entitySchemaSandboxScript.kind, input.kind),
				eq(entitySchemaSandboxScript.sandboxScriptId, sandboxScript.id),
			),
		)
		.innerJoin(
			entitySchema,
			eq(entitySchema.id, entitySchemaSandboxScript.entitySchemaId),
		)
		.where(eq(sandboxScript.id, input.scriptId))
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
					eq(entity.externalId, input.payload.externalId),
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
			externalId: input.payload.externalId,
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
