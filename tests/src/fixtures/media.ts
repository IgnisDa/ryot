import { getPgClient } from "../setup";

export async function queryInLibraryRelationship(
	entityId: string,
	email: string,
) {
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

export async function insertLibraryMembership(input: {
	userId: string;
	mediaEntityId: string;
}) {
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
	if (!libraryEntityId) {
		throw new Error(`Missing library entity for user '${input.userId}'`);
	}

	const schemaResult = await pg.query<{ id: string }>(
		`select id from relationship_schema
		 where slug = 'in-library' and user_id is null
		 limit 1`,
	);
	const inLibrarySchemaId = schemaResult.rows[0]?.id;
	if (!inLibrarySchemaId) {
		throw new Error("Missing in-library relationship schema");
	}

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
