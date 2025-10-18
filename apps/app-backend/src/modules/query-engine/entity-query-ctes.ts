import { sql } from "drizzle-orm";

import { entity, entitySchema } from "~/lib/db/schema";

import { buildEntitySchemaDataExpression } from "./query-cte-shared";

const buildEntitySelectColumns = () => {
	const entitySchemaData = buildEntitySchemaDataExpression();
	return sql`
		${entity.id} as id,
		${entity.name} as name,
		${entity.image} as image,
		${entity.createdAt} as created_at,
		${entity.updatedAt} as updated_at,
		${entity.properties} as properties,
		${entity.externalId} as external_id,
		${entitySchemaData} as entity_schema_data,
		${entity.sandboxScriptId} as sandbox_script_id
	`;
};

export const buildBaseEntitiesCte = (input: { userId: string; entitySchemaIds: string[] }) => {
	const entitySchemaIdList = sql.join(
		input.entitySchemaIds.map((entitySchemaId) => sql`${entitySchemaId}`),
		sql`, `,
	);

	const entityColumns = buildEntitySelectColumns();

	const userOwnedEntities = sql`
		select ${entityColumns}
		from ${entity}
		inner join ${entitySchema}
			on ${entity.entitySchemaId} = ${entitySchema.id}
		where ${entity.userId} = ${input.userId}
			and ${entity.entitySchemaId} in (${entitySchemaIdList})
	`;

	return sql`
		base_entities as (
			${userOwnedEntities}
			union all
			select ${entityColumns}
			from ${entity}
			inner join ${entitySchema}
				on ${entity.entitySchemaId} = ${entitySchema.id}
			where ${entity.userId} is null
				and ${entity.entitySchemaId} in (${entitySchemaIdList})
		)
	`;
};
