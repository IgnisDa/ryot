import { sql } from "drizzle-orm";

import { entity, entitySchema } from "~/lib/db/schema";

import { buildEntitySelectColumns } from "./query-cte-shared";

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
