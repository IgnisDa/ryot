import { getPgClient } from "../setup";
import { requirePresent } from "../test-support/assertions";

export async function createRelationshipSchema(input: {
	slug: string;
	name: string;
	userId: string;
	propertiesSchema: Record<string, unknown>;
}) {
	const pg = getPgClient();
	const id = crypto.randomUUID();

	await pg.query(
		`insert into relationship_schema (id, slug, name, user_id, properties_schema, is_builtin)
		 values ($1, $2, $3, $4, $5::jsonb, false)`,
		[id, input.slug, input.name, input.userId, JSON.stringify(input.propertiesSchema)],
	);

	return { id, slug: input.slug };
}

export async function insertRelationshipRow(input: {
	userId: string;
	createdAt?: Date;
	sourceEntityId: string;
	targetEntityId: string;
	relationshipSchemaId: string;
	properties?: Record<string, unknown>;
}) {
	const pg = getPgClient();
	const id = crypto.randomUUID();
	const properties = input.properties ?? {};

	if (input.createdAt) {
		await pg.query(
			`insert into relationship (id, user_id, relationship_schema_id, properties, source_entity_id, target_entity_id, created_at)
			 values ($1, $2, $3, $4::jsonb, $5, $6, $7)
			 on conflict (user_id, source_entity_id, target_entity_id, relationship_schema_id) do nothing`,
			[
				id,
				input.userId,
				input.relationshipSchemaId,
				JSON.stringify(properties),
				input.sourceEntityId,
				input.targetEntityId,
				input.createdAt.toISOString(),
			],
		);
	} else {
		await pg.query(
			`insert into relationship (id, user_id, relationship_schema_id, properties, source_entity_id, target_entity_id)
			 values ($1, $2, $3, $4::jsonb, $5, $6)
			 on conflict (user_id, source_entity_id, target_entity_id, relationship_schema_id) do nothing`,
			[
				id,
				input.userId,
				input.relationshipSchemaId,
				JSON.stringify(properties),
				input.sourceEntityId,
				input.targetEntityId,
			],
		);
	}

	return { id };
}

export async function queryInLibraryRelationship(entityId: string, email: string) {
	return getPgClient().query<{ id: string }>(
		`select r.id
		 from relationship r
		 inner join relationship_schema rs on rs.id = r.relationship_schema_id
		 inner join entity library_entity on library_entity.id = r.target_entity_id
		 inner join entity_schema library_schema on library_schema.id = library_entity.entity_schema_id
		 inner join "user" u on u.id = library_entity.user_id
		 where rs.slug = 'in-library'
		   and r.user_id = u.id
		   and r.source_entity_id = $1
		   and u.email = $2
		   and library_schema.slug = 'library'
		 limit 1`,
		[entityId, email],
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

export async function getRelationshipBySchemaSlug(input: {
	sourceEntityId: string;
	targetEntityId: string;
	relationshipSchemaSlug: string;
}) {
	const pg = getPgClient();
	const result = await pg.query<{
		properties: Record<string, unknown>;
		sourceEntityId: string;
		targetEntityId: string;
	}>(
		`select r.properties,
		        r.source_entity_id as "sourceEntityId",
		        r.target_entity_id as "targetEntityId"
		 from relationship r
		 inner join relationship_schema rs on rs.id = r.relationship_schema_id
		 where rs.slug = $1
		   and r.source_entity_id = $2
		   and r.target_entity_id = $3
		   and r.user_id is null
		 limit 1`,
		[input.relationshipSchemaSlug, input.sourceEntityId, input.targetEntityId],
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
	const id = crypto.randomUUID();

	await getPgClient().query(
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
		id,
		name: input.name,
		image: input.image,
		userId: input.userId ?? null,
		properties: input.properties,
		externalId: input.externalId,
		entitySchemaId: input.entitySchemaId,
		sandboxScriptId: input.sandboxScriptId,
	};
}

export async function insertLibraryMembership(input: { userId: string; mediaEntityId: string }) {
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
	const libraryEntityId = libraryResult.rows[0]?.id;
	requirePresent(libraryEntityId, `Missing library entity for user '${input.userId}'`);

	const schemaResult = await pg.query<{ id: string }>(
		`select id from relationship_schema
		 where slug = 'in-library' and user_id is null
		 limit 1`,
	);
	const inLibrarySchemaId = schemaResult.rows[0]?.id;
	requirePresent(inLibrarySchemaId, "Missing in-library relationship schema");

	await pg.query(
		`insert into relationship (
				id,
				user_id,
				relationship_schema_id,
				properties,
				source_entity_id,
				target_entity_id
			) values ($1, $2, $3, $4::jsonb, $5, $6)
			on conflict (user_id, source_entity_id, target_entity_id, relationship_schema_id) do nothing`,
		[
			crypto.randomUUID(),
			input.userId,
			inLibrarySchemaId,
			JSON.stringify({}),
			input.mediaEntityId,
			libraryEntityId,
		],
	);
}
