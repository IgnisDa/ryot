import { EntityId, RelationshipSchemaId } from "@ryot/app-backend/schema/brands";

import { getPgClient } from "../setup";
import { requirePresent } from "../test-support/assertions";
import type { Client } from "./auth";
import { findBuiltinSchemaWithProviders, getFirstProviderScriptId } from "./entity-schemas";
import { listRelationshipSchemas, requireRelationshipSchemaBySlug } from "./relationship-schemas";
import { createRelationship } from "./relationships";

export async function insertRelationshipRow(
	client: Client,
	input: {
		sourceEntityId: string;
		targetEntityId: string;
		relationshipSchemaId: string;
		properties?: Record<string, unknown>;
	},
) {
	return createRelationship(client, {
		properties: input.properties,
		sourceEntityId: EntityId.make(input.sourceEntityId),
		targetEntityId: EntityId.make(input.targetEntityId),
		relationshipSchemaId: RelationshipSchemaId.make(input.relationshipSchemaId),
	});
}

export async function queryInLibraryRelationship(client: Client, entityId: string, email: string) {
	const schemas = await listRelationshipSchemas(client, { slugs: ["in-library"] });
	const inLibrarySchema = requireRelationshipSchemaBySlug(schemas, "in-library");

	return getPgClient().query<{ id: string }>(
		`select r.id
		 from relationship r
		 inner join entity library_entity on library_entity.id = r.target_entity_id
		 inner join entity_schema library_schema on library_schema.id = library_entity.entity_schema_id
		 inner join "user" u on u.id = library_entity.user_id
		 where r.relationship_schema_id = $1
		   and r.user_id = u.id
		   and r.source_entity_id = $2
		   and u.email = $3
		   and library_schema.slug = 'library'
		 limit 1`,
		[inLibrarySchema.id, entityId, email],
	);
}

export async function deleteGlobalEntityByProvenance(input: {
	externalId: string;
	entitySchemaId: string;
	sandboxScriptId: string;
}) {
	const pg = getPgClient();

	await pg.query(
		`delete from entity
		 where external_id = $1
		   and entity_schema_id = $2
		   and sandbox_script_id = $3
		   and user_id is null`,
		[input.externalId, input.entitySchemaId, input.sandboxScriptId],
	);
}

export async function getGlobalEntityByProvenance(input: {
	externalId: string;
	entitySchemaId: string;
	sandboxScriptId: string;
}) {
	const pg = getPgClient();
	const result = await pg.query<{
		id: string;
		name: string;
		populatedAt: string | null;
	}>(
		`select e.id, e.name, e.populated_at::text as "populatedAt"
		 from entity e
		 where e.external_id = $1
		   and e.entity_schema_id = $2
		   and e.sandbox_script_id = $3
		   and e.user_id is null
		 limit 1`,
		[input.externalId, input.entitySchemaId, input.sandboxScriptId],
	);

	return requirePresent(
		result.rows[0],
		`Missing global entity for external id '${input.externalId}'`,
	);
}

export async function getRelationshipBySchemaSlug(
	client: Client,
	input: {
		sourceEntityId: string;
		targetEntityId: string;
		relationshipSchemaSlug: string;
	},
) {
	const pg = getPgClient();
	const schemas = await listRelationshipSchemas(client, { slugs: [input.relationshipSchemaSlug] });
	const relationshipSchema = requireRelationshipSchemaBySlug(schemas, input.relationshipSchemaSlug);
	const result = await pg.query<{
		properties: Record<string, unknown>;
		sourceEntityId: string;
		targetEntityId: string;
	}>(
		`select r.properties,
		        r.source_entity_id as "sourceEntityId",
		        r.target_entity_id as "targetEntityId"
		 from relationship r
		 where r.relationship_schema_id = $1
		   and r.source_entity_id = $2
		   and r.target_entity_id = $3
		   and r.user_id is null
		 limit 1`,
		[relationshipSchema.id, input.sourceEntityId, input.targetEntityId],
	);

	return requirePresent(
		result.rows[0],
		`Missing relationship '${input.relationshipSchemaSlug}' for '${input.sourceEntityId}' -> '${input.targetEntityId}'`,
	);
}

export async function seedMediaEntity(input: {
	name: string;
	externalId: string;
	userId?: string | null;
	entitySchemaId: string;
	sandboxScriptId: string | null;
	properties: Record<string, unknown>;
	image: Record<string, unknown> | null;
}) {
	const pg = getPgClient();
	const id = crypto.randomUUID();

	await pg.query(
		`insert into entity (
			id,
			name,
			image,
			user_id,
			properties,
			external_id,
			entity_schema_id,
			sandbox_script_id
		) values ($1, $2, $3::jsonb, $4, $5::jsonb, $6, $7, $8)`,
		[
			id,
			input.name,
			JSON.stringify(input.image),
			input.userId ?? null,
			JSON.stringify(input.properties),
			input.externalId,
			input.entitySchemaId,
			input.sandboxScriptId,
		],
	);

	return {
		id: EntityId.make(id),
		name: input.name,
		image: input.image,
		userId: input.userId ?? null,
		properties: input.properties,
		externalId: input.externalId,
		entitySchemaId: input.entitySchemaId,
		sandboxScriptId: input.sandboxScriptId,
	};
}

export async function createGlobalBookEntityFixture(
	client: Client,
	options: { name?: string; externalId?: string } = {},
) {
	const { schema } = await findBuiltinSchemaWithProviders(client);
	const entity = await seedMediaEntity({
		image: null,
		userId: null,
		properties: {},
		entitySchemaId: schema.id,
		sandboxScriptId: getFirstProviderScriptId(schema),
		externalId: options.externalId ?? `global-book-${crypto.randomUUID()}`,
		name: options.name ?? `Global Built-in Book ${crypto.randomUUID()}`,
	});
	return { entity, schema };
}

export async function insertLibraryMembership(
	client: Client,
	input: { userId: string; mediaEntityId: string },
) {
	const pg = getPgClient();

	const libraryResult = await pg.query<{ id: string }>(
		`select e.id
		 from entity e
		 inner join entity_schema es on es.id = e.entity_schema_id
		 where e.user_id = $1
		   and es.slug = 'library'
		   and es.user_id is null
		 limit 1`,
		[input.userId],
	);
	const libraryEntityId = requirePresent(
		libraryResult.rows[0]?.id,
		`Missing library entity for user '${input.userId}'`,
	);

	const schemas = await listRelationshipSchemas(client, { slugs: ["in-library"] });
	const inLibrarySchema = requireRelationshipSchemaBySlug(schemas, "in-library");

	await createRelationship(client, {
		properties: {},
		sourceEntityId: EntityId.make(input.mediaEntityId),
		targetEntityId: EntityId.make(libraryEntityId),
		relationshipSchemaId: inLibrarySchema.id,
	});
}
