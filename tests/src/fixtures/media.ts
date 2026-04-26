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
