import { sql } from "drizzle-orm";

import { entity, entitySchema, relationship } from "~/lib/db/schema";

import { buildEntitySchemaDataExpression } from "./query-cte-shared";
import type { SqlExpression } from "./sql-expression-helpers";

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

const buildNonUserOwnedWhereClause = (input: {
	userId: string;
	entitySchemaIdList: SqlExpression;
	relationshipSchemaIds: string[];
}) => {
	if (input.relationshipSchemaIds.length === 0) {
		return sql`${entity.userId} is null
			and ${entity.entitySchemaId} in (${input.entitySchemaIdList})`;
	}

	const relationshipSchemaIdList = sql.join(
		input.relationshipSchemaIds.map((id) => sql`${id}`),
		sql`, `,
	);
	return sql`${entity.userId} is null
		and ${entity.entitySchemaId} in (${input.entitySchemaIdList})
		and exists (
			select 1
			from ${relationship}
			where ${relationship.sourceEntityId} = ${entity.id}
				and ${relationship.userId} = ${input.userId}
				and ${relationship.relationshipSchemaId} in (${relationshipSchemaIdList})
		)`;
};

export const buildBaseEntitiesCte = (input: {
	userId: string;
	entitySchemaIds: string[];
	relationshipSchemaIds: string[];
}) => {
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

	const nonUserOwnedClause = buildNonUserOwnedWhereClause({
		userId: input.userId,
		entitySchemaIdList,
		relationshipSchemaIds: input.relationshipSchemaIds,
	});

	return sql`
		base_entities as (
			${userOwnedEntities}
			union all
			select ${entityColumns}
			from ${entity}
			inner join ${entitySchema}
				on ${entity.entitySchemaId} = ${entitySchema.id}
			where ${nonUserOwnedClause}
		)
	`;
};
