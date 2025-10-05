import { sql } from "drizzle-orm";

import { schema } from "#lib/db";

import { buildEntitySelectColumns } from "./query-cte-shared";

export const buildBaseEntitiesCte = (input: {
	userId: string;
	entitySchemaIds: ReadonlyArray<string>;
}) => {
	const entitySchemaIdList = sql.join(
		input.entitySchemaIds.map((entitySchemaId) => sql`${entitySchemaId}`),
		sql`, `,
	);

	const entityColumns = buildEntitySelectColumns();

	const userOwnedEntities = sql`
		select ${entityColumns}
		from ${schema.entity}
		inner join ${schema.entitySchema}
			on ${schema.entity.entitySchemaId} = ${schema.entitySchema.id}
		where ${schema.entity.userId} = ${input.userId}
			and ${schema.entity.entitySchemaId} in (${entitySchemaIdList})
	`;

	return sql`
		base_entities as (
			${userOwnedEntities}
			union all
			select ${entityColumns}
			from ${schema.entity}
			inner join ${schema.entitySchema}
				on ${schema.entity.entitySchemaId} = ${schema.entitySchema.id}
			where ${schema.entity.userId} is null
				and ${schema.entity.entitySchemaId} in (${entitySchemaIdList})
		)
	`;
};
