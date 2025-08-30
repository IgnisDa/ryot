import { sql } from "drizzle-orm";

import { event } from "~/lib/db/schema";
import type { QueryEngineEventJoinLike } from "~/lib/views/reference";

import type { LoadedRelationshipJoin } from "./context";
import { getEventJoinCteName } from "./query-cte-shared";
import {
	getEventJoinColumnName,
	getRelationshipJoinCteName,
	getRelationshipJoinColumnName,
	sanitizeIdentifier,
} from "./sql-expression-helpers";

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
	relationshipJoins?: LoadedRelationshipJoin[];
}) => {
	sanitizeIdentifier(input.cteName, "CTE name");
	sanitizeIdentifier(input.baseCte, "CTE name");
	sanitizeIdentifier(input.entityIdColumn, "column name");
	const selectEventJoins = input.eventJoins.map((join) => {
		sanitizeIdentifier(join.key, "event join key");
		return sql`${sql.raw(getEventJoinCteName(join.key))}.latest_event as ${sql.raw(getEventJoinColumnName(join.key))}`;
	});
	const selectRelationshipJoins = (input.relationshipJoins ?? []).map((join) => {
		sanitizeIdentifier(join.key, "relationship join key");
		return sql`${sql.raw(getRelationshipJoinCteName(join.key))}.latest_relationship as ${sql.raw(getRelationshipJoinColumnName(join.key))}`;
	});
	const selectJoins = [...selectEventJoins, ...selectRelationshipJoins];

	const leftEventJoins = input.eventJoins.map((join) => {
		return sql`
			left join ${sql.raw(getEventJoinCteName(join.key))}
				on ${sql.raw(getEventJoinCteName(join.key))}.entity_id = ${sql.raw(input.baseCte)}.${sql.raw(input.entityIdColumn)}
		`;
	});
	const leftRelationshipJoins = (input.relationshipJoins ?? []).map((join) => {
		return sql`
			left join ${sql.raw(getRelationshipJoinCteName(join.key))}
				on ${sql.raw(getRelationshipJoinCteName(join.key))}.entity_id = ${sql.raw(input.baseCte)}.${sql.raw(input.entityIdColumn)}
		`;
	});
	const leftJoins = [...leftEventJoins, ...leftRelationshipJoins];

	return sql`
		${sql.raw(input.cteName)} as (
			select
				${sql.raw(input.baseCte)}.*${selectJoins.length ? sql`, ${sql.join(selectJoins, sql`, `)}` : sql``}
			from ${sql.raw(input.baseCte)}
			${sql.join(leftJoins, sql` `)}
		)
	`;
};

export const buildJoinedEntitiesCte = (input: {
	eventJoins: QueryEngineEventJoinLike[];
	relationshipJoins?: LoadedRelationshipJoin[];
}) =>
	buildJoinedCte({
		entityIdColumn: "id",
		baseCte: "base_entities",
		cteName: "joined_entities",
		eventJoins: input.eventJoins,
		relationshipJoins: input.relationshipJoins,
	});
