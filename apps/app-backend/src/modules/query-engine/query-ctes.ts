import { sql } from "drizzle-orm";
import {
	entity,
	entitySchema,
	event,
	eventSchema,
	relationship,
} from "~/lib/db/schema";
import type {
	EntityColumnOverrides,
	QueryEngineEventJoinLike,
	QueryEngineSchemaLike,
} from "~/lib/views/reference";
import {
	getEventJoinColumnName,
	type SqlExpression,
	sanitizeIdentifier,
} from "./sql-expression-helpers";

export type QueryEngineSchemaRow = QueryEngineSchemaLike & {
	id: string;
};

export type PaginationConfig = {
	limit: number;
	offset: number;
	countAlias: string;
	rowIdColumn: string;
	sortedAlias: string;
	filteredAlias: string;
	paginatedAlias: string;
	joinedTableName: string;
};

export const EVENT_FIRST_ENTITY_COLUMN_OVERRIDES: EntityColumnOverrides = {
	id: "entity_id",
	properties: "entity_properties",
	created_at: "entity_created_at",
	updated_at: "entity_updated_at",
};

const buildEntitySchemaDataExpression = () =>
	sql`jsonb_build_object(
		'id', ${entitySchema.id},
		'slug', ${entitySchema.slug},
		'name', ${entitySchema.name},
		'icon', ${entitySchema.icon},
		'userId', ${entitySchema.userId},
		'isBuiltin', ${entitySchema.isBuiltin},
		'createdAt', ${entitySchema.createdAt},
		'updatedAt', ${entitySchema.updatedAt},
		'accentColor', ${entitySchema.accentColor}
	)`;

const buildEventSchemaDataExpression = () =>
	sql`jsonb_build_object(
		'id', ${eventSchema.id},
		'slug', ${eventSchema.slug},
		'name', ${eventSchema.name},
		'isBuiltin', ${eventSchema.isBuiltin},
		'createdAt', ${eventSchema.createdAt},
		'updatedAt', ${eventSchema.updatedAt}
	)`;

export const getEventJoinCteName = (joinKey: string) =>
	`latest_event_join_${joinKey}`;

export const buildBaseEntitiesCte = (input: {
	userId: string;
	entitySchemaIds: string[];
	relationshipSchemaIds: string[];
}) => {
	const entitySchemaIdList = sql.join(
		input.entitySchemaIds.map((entitySchemaId) => sql`${entitySchemaId}`),
		sql`, `,
	);

	const entitySchemaData = buildEntitySchemaDataExpression();

	const entityColumns = sql`
		${entity.id} as id,
		${entity.name} as name,
		${entity.image} as image,
		${entity.createdAt} as created_at,
		${entity.updatedAt} as updated_at,
		${entity.properties} as properties,
		${entity.externalId} as external_id,
		${entity.sandboxScriptId} as sandbox_script_id,
		${entitySchemaData} as entity_schema_data
	`;

	const userOwnedEntities = sql`
		select ${entityColumns}
		from ${entity}
		inner join ${entitySchema}
			on ${entity.entitySchemaId} = ${entitySchema.id}
		where ${entity.userId} = ${input.userId}
			and ${entity.entitySchemaId} in (${entitySchemaIdList})
	`;

	if (input.relationshipSchemaIds.length === 0) {
		return sql`
			base_entities as (
				${userOwnedEntities}
				union
				select ${entityColumns}
				from ${entity}
				inner join ${entitySchema}
					on ${entity.entitySchemaId} = ${entitySchema.id}
				where ${entity.userId} is null
					and ${entity.entitySchemaId} in (${entitySchemaIdList})
			)
		`;
	}

	const relationshipSchemaIdList = sql.join(
		input.relationshipSchemaIds.map((id) => sql`${id}`),
		sql`, `,
	);

	return sql`
		base_entities as (
			${userOwnedEntities}
			union
			select ${entityColumns}
			from ${entity}
			inner join ${entitySchema}
				on ${entity.entitySchemaId} = ${entitySchema.id}
			inner join ${relationship}
				on ${relationship.sourceEntityId} = ${entity.id}
			where ${entity.userId} is null
				and ${entity.entitySchemaId} in (${entitySchemaIdList})
				and ${relationship.userId} = ${input.userId}
				and ${relationship.relationshipSchemaId} in (${relationshipSchemaIdList})
		)
	`;
};

export const buildEventFirstCte = (input: {
	userId: string;
	cteName: string;
	entitySchemaIds: string[];
	eventSchemaSlugs: string[];
	dateRange?: { startAt: string; endAt: string };
}) => {
	sanitizeIdentifier(input.cteName, "CTE name");
	const entitySchemaIdList = sql.join(
		input.entitySchemaIds.map((id) => sql`${id}`),
		sql`, `,
	);
	const eventSchemaSlugList = sql.join(
		input.eventSchemaSlugs.map((slug) => sql`${slug}`),
		sql`, `,
	);

	const entitySchemaData = buildEntitySchemaDataExpression();
	const eventSchemaData = buildEventSchemaDataExpression();
	const dateRangeClause = input.dateRange
		? sql`and ${event.createdAt} >= ${input.dateRange.startAt}::timestamptz
			and ${event.createdAt} < ${input.dateRange.endAt}::timestamptz`
		: sql``;

	return sql`
		${sql.raw(input.cteName)} as (
			select
				${event.id} as id,
				${event.createdAt} as created_at,
				${event.updatedAt} as updated_at,
				${event.properties} as properties,
				${event.entityId} as entity_id,
				${entity.name} as name,
				${entity.image} as image,
				${entity.createdAt} as entity_created_at,
				${entity.updatedAt} as entity_updated_at,
				${entity.properties} as entity_properties,
				${entity.externalId} as external_id,
				${entity.sandboxScriptId} as sandbox_script_id,
				${entitySchemaData} as entity_schema_data,
				${eventSchemaData} as event_schema_data
			from ${event}
			inner join ${entity} on ${event.entityId} = ${entity.id}
			inner join ${entitySchema} on ${entity.entitySchemaId} = ${entitySchema.id}
			inner join ${eventSchema} on ${event.eventSchemaId} = ${eventSchema.id}
			where ${event.userId} = ${input.userId}
				and (${entity.userId} = ${input.userId} or ${entity.userId} is null)
				and ${entity.entitySchemaId} in (${entitySchemaIdList})
				and ${eventSchema.slug} in (${eventSchemaSlugList})
				${dateRangeClause}
		)
	`;
};

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

export const buildJoinedEntitiesCte = (
	eventJoins: QueryEngineEventJoinLike[],
) =>
	buildJoinedCte({
		eventJoins,
		entityIdColumn: "id",
		baseCte: "base_entities",
		cteName: "joined_entities",
	});

export const buildPaginatedQuerySql = (
	input: PaginationConfig & {
		direction: SqlExpression;
		withCtes: SqlExpression[];
		filterClause: SqlExpression;
		sortExpression: SqlExpression;
		resolvedFields: SqlExpression;
	},
) => {
	sanitizeIdentifier(input.rowIdColumn, "column name");
	sanitizeIdentifier(input.countAlias, "CTE alias");
	sanitizeIdentifier(input.sortedAlias, "CTE alias");
	sanitizeIdentifier(input.filteredAlias, "CTE alias");
	sanitizeIdentifier(input.paginatedAlias, "CTE alias");
	sanitizeIdentifier(input.joinedTableName, "table name");
	const cteList = sql.join(input.withCtes, sql`, `);

	return sql`
		with
			${cteList},
			${sql.raw(input.filteredAlias)} as (
				select * from ${sql.raw(input.joinedTableName)} where ${input.filterClause}
			),
			${sql.raw(input.sortedAlias)} as (
				select
					${sql.raw(input.filteredAlias)}.*,
					count(*) over ()::integer as total,
					row_number() over (
						order by ${input.sortExpression} ${input.direction} nulls last, ${sql.raw(input.filteredAlias)}.id asc
					) as sort_index
				from ${sql.raw(input.filteredAlias)}
			),
			${sql.raw(input.countAlias)} as (
				select coalesce(max(total), 0)::integer as total
				from ${sql.raw(input.sortedAlias)}
			),
			${sql.raw(input.paginatedAlias)} as (
				select *
				from ${sql.raw(input.sortedAlias)}
				order by sort_index
				offset ${input.offset}
				limit ${input.limit}
			)
		select
			${sql.raw(input.paginatedAlias)}.${sql.raw(input.rowIdColumn)} as row_id,
			${sql.raw(input.countAlias)}.total,
			${input.resolvedFields} as fields
		from ${sql.raw(input.countAlias)}
		left join ${sql.raw(input.paginatedAlias)} on true
		order by sort_index
	`;
};
