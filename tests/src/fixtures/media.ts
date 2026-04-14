import { getPgClient } from "../setup";

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
