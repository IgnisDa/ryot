import { sql } from "drizzle-orm";

import { event } from "~/lib/db/schema";
import type { QueryEngineEventJoinLike } from "~/lib/views/reference";

import { getEventJoinCteName } from "./query-cte-shared";
import { getEventJoinColumnName, sanitizeIdentifier } from "./sql-expression-helpers";

export const buildLatestEventJoinCte = (input: {
	join: QueryEngineEventJoinLike;
	userId: string;
}) => {
	sanitizeIdentifier(input.join.key, "event join key");
	const eventSchemaIdList = sql.join(
		input.join.eventSchemas.map((schema) => sql`${schema.id}`),
		sql`, `,
	);

	return sql`
		${sql.raw(getEventJoinCteName(input.join.key))} as (
			select distinct on (${event.entityId})
				${event.entityId} as entity_id,
				jsonb_build_object(
					'id', ${event.id},
					'createdAt', ${event.createdAt},
					'updatedAt', ${event.updatedAt},
					'properties', ${event.properties}
				) as latest_event
			from ${event}
			where ${event.userId} = ${input.userId}
				and ${event.eventSchemaId} in (${eventSchemaIdList})
			order by ${event.entityId}, ${event.createdAt} desc, ${event.id} desc
		)
	`;
};

export const buildJoinedCte = (input: {
	cteName: string;
	baseCte: string;
	entityIdColumn: string;
	eventJoins: QueryEngineEventJoinLike[];
}) => {
	sanitizeIdentifier(input.cteName, "CTE name");
	sanitizeIdentifier(input.baseCte, "CTE name");
	sanitizeIdentifier(input.entityIdColumn, "column name");
	const selectJoins = input.eventJoins.map((join) => {
		sanitizeIdentifier(join.key, "event join key");
		return sql`${sql.raw(getEventJoinCteName(join.key))}.latest_event as ${sql.raw(getEventJoinColumnName(join.key))}`;
	});
	const leftJoins = input.eventJoins.map((join) => {
		return sql`
			left join ${sql.raw(getEventJoinCteName(join.key))}
				on ${sql.raw(getEventJoinCteName(join.key))}.entity_id = ${sql.raw(input.baseCte)}.${sql.raw(input.entityIdColumn)}
		`;
	});

	return sql`
		${sql.raw(input.cteName)} as (
			select
				${sql.raw(input.baseCte)}.*${selectJoins.length ? sql`, ${sql.join(selectJoins, sql`, `)}` : sql``}
			from ${sql.raw(input.baseCte)}
			${sql.join(leftJoins, sql` `)}
		)
	`;
};

export const buildJoinedEntitiesCte = (eventJoins: QueryEngineEventJoinLike[]) =>
	buildJoinedCte({
		eventJoins,
		entityIdColumn: "id",
		baseCte: "base_entities",
		cteName: "joined_entities",
	});
