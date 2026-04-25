import { sql } from "drizzle-orm";
import { db } from "~/lib/db";
import {
	entity,
	entitySchema,
	event,
	relationship,
	relationshipSchema,
} from "~/lib/db/schema";
import type {
	QueryEngineEventJoinLike,
	QueryEngineReferenceContext,
	QueryEngineSchemaLike,
} from "~/lib/views/reference";
import type { ImageSchemaType } from "~/lib/zod";
import { getUserLibraryEntityId } from "~/modules/entities";
import { buildResolvedFieldsExpression } from "./display-builder";
import { buildFilterWhereClause } from "./filter-builder";
import type {
	QueryEngineItem,
	QueryEngineRequest,
	QueryEngineResponse,
} from "./schemas";
import { buildSortExpression } from "./sort-builder";

export type QueryEngineSchemaRow = QueryEngineSchemaLike & {
	id: string;
};

export type QueryEnginePreparedEventJoin = QueryEngineEventJoinLike;

type QueryRow = {
	total: number;
	id: string | null;
	name: string | null;
	created_at: Date | null;
	updated_at: Date | null;
	external_id: string | null;
	image: ImageSchemaType | null;
	entity_schema_id: string | null;
	sandbox_script_id: string | null;
	entity_schema_slug: string | null;
	fields: QueryEngineItem["fields"] | null;
};

type PaginationInput = {
	page: number;
	total: number;
	limit: number;
};

type PaginationResult = PaginationInput & {
	totalPages: number;
	hasNextPage: boolean;
	hasPreviousPage: boolean;
};

const getEventJoinCteName = (joinKey: string) => `latest_event_join_${joinKey}`;
const getEventJoinColumnName = (joinKey: string) => `event_join_${joinKey}`;

const buildBaseEntitiesCte = (input: {
	userId: string;
	userLibraryEntityId: string | undefined;
	entitySchemaIds: string[];
}) => {
	const entitySchemaIdList = sql.join(
		input.entitySchemaIds.map((entitySchemaId) => sql`${entitySchemaId}`),
		sql`, `,
	);
	const libraryMembershipClause = input.userLibraryEntityId
		? sql`${relationship.targetEntityId} = ${input.userLibraryEntityId}`
		: sql`false`;

	return sql`
		base_entities as (
			select
				${entity.id} as id,
				${entity.name} as name,
				${entity.image} as image,
				${entity.createdAt} as created_at,
				${entity.updatedAt} as updated_at,
				${entity.properties} as properties,
				${entity.externalId} as external_id,
				${entitySchema.slug} as entity_schema_slug,
				${entity.entitySchemaId} as entity_schema_id,
				${entity.sandboxScriptId} as sandbox_script_id
			from ${entity}
			inner join ${entitySchema}
				on ${entity.entitySchemaId} = ${entitySchema.id}
			where ${entity.userId} = ${input.userId}
				and ${entity.entitySchemaId} in (${entitySchemaIdList})
			union
			select
				${entity.id} as id,
				${entity.name} as name,
				${entity.image} as image,
				${entity.createdAt} as created_at,
				${entity.updatedAt} as updated_at,
				${entity.properties} as properties,
				${entity.externalId} as external_id,
				${entitySchema.slug} as entity_schema_slug,
				${entity.entitySchemaId} as entity_schema_id,
				${entity.sandboxScriptId} as sandbox_script_id
			from ${entity}
			inner join ${entitySchema}
				on ${entity.entitySchemaId} = ${entitySchema.id}
			inner join ${relationship}
				on ${relationship.sourceEntityId} = ${entity.id}
			where ${entity.userId} is null
				and ${entity.entitySchemaId} in (${entitySchemaIdList})
				and ${relationship.userId} = ${input.userId}
				and ${relationship.relationshipSchemaId} = (
				select ${relationshipSchema.id}
				from ${relationshipSchema}
				where ${relationshipSchema.slug} = 'in-library'
				and ${relationshipSchema.userId} is null
				limit 1
			)
				and ${libraryMembershipClause}
		)
	`;
};

const buildLatestEventJoinCte = (input: {
	join: QueryEnginePreparedEventJoin;
	userId: string;
}) => {
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

const buildJoinedEntitiesCte = (eventJoins: QueryEnginePreparedEventJoin[]) => {
	const selectJoins = eventJoins.map((join) => {
		return sql`${sql.raw(getEventJoinCteName(join.key))}.latest_event as ${sql.raw(getEventJoinColumnName(join.key))}`;
	});
	const leftJoins = eventJoins.map((join) => {
		return sql`
			left join ${sql.raw(getEventJoinCteName(join.key))}
				on ${sql.raw(getEventJoinCteName(join.key))}.entity_id = base_entities.id
		`;
	});

	return sql`
		joined_entities as (
			select
				base_entities.*${selectJoins.length ? sql`, ${sql.join(selectJoins, sql`, `)}` : sql``}
			from base_entities
			${sql.join(leftJoins, sql` `)}
		)
	`;
};

export const calculatePagination = (
	input: PaginationInput,
): PaginationResult => {
	const totalPages =
		input.total === 0 ? 0 : Math.ceil(input.total / input.limit);

	return {
		...input,
		totalPages,
		hasNextPage: input.page < totalPages,
		hasPreviousPage: totalPages > 0 && input.page > 1,
	};
};

export const mapQueryRowToItem = (row: QueryRow): QueryEngineItem | null => {
	if (
		row.id === null ||
		row.name === null ||
		row.created_at === null ||
		row.updated_at === null ||
		row.entity_schema_id === null ||
		row.entity_schema_slug === null
	) {
		return null;
	}

	const baseItem = {
		id: row.id,
		name: row.name,
		image: row.image,
		fields: row.fields ?? [],
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		externalId: row.external_id,
		entitySchemaId: row.entity_schema_id,
		sandboxScriptId: row.sandbox_script_id,
		entitySchemaSlug: row.entity_schema_slug,
	};

	return baseItem satisfies QueryEngineItem;
};

export const executePreparedQuery = async (input: {
	userId: string;
	request: QueryEngineRequest;
	runtimeSchemas: QueryEngineSchemaRow[];
	eventJoins: QueryEnginePreparedEventJoin[];
	schemaMap: Map<string, QueryEngineSchemaRow>;
	eventJoinMap: Map<string, QueryEnginePreparedEventJoin>;
}): Promise<QueryEngineResponse> => {
	const context: QueryEngineReferenceContext<
		QueryEngineSchemaRow,
		QueryEnginePreparedEventJoin
	> = { schemaMap: input.schemaMap, eventJoinMap: input.eventJoinMap };
	const filterWhereClause = buildFilterWhereClause({
		context,
		alias: "joined_entities",
		predicate: input.request.filter,
		computedFields: input.request.computedFields,
	});
	const userLibraryEntityId = await getUserLibraryEntityId({
		userId: input.userId,
	});
	const baseEntitiesCte = buildBaseEntitiesCte({
		userLibraryEntityId,
		userId: input.userId,
		entitySchemaIds: input.runtimeSchemas.map((schema) => schema.id),
	});
	const latestEventJoinCtes = input.eventJoins.map((join) => {
		return buildLatestEventJoinCte({ join, userId: input.userId });
	});
	const joinedEntitiesCte = buildJoinedEntitiesCte(input.eventJoins);
	const sortExpression = buildSortExpression({
		context,
		alias: "filtered_entities",
		expression: input.request.sort.expression,
		computedFields: input.request.computedFields,
	});
	const offset =
		(input.request.pagination.page - 1) * input.request.pagination.limit;
	const resolvedFields = buildResolvedFieldsExpression({
		context,
		alias: "paginated_entities",
		fields: input.request.fields,
		computedFields: input.request.computedFields,
	});
	const direction = sql.raw(input.request.sort.direction.toUpperCase());
	const filterClause = filterWhereClause ?? sql`true`;

	const dataResult = await db.execute<QueryRow>(sql`
		with
			${baseEntitiesCte}${latestEventJoinCtes.length ? sql`, ${sql.join(latestEventJoinCtes, sql`, `)}` : sql``},
			${joinedEntitiesCte},
			filtered_entities as (
				select *
				from joined_entities
				where ${filterClause}
			),
			sorted_entities as (
				select
					filtered_entities.*,
					count(*) over ()::integer as total,
					row_number() over (
						order by ${sortExpression} ${direction} nulls last, filtered_entities.id asc
					) as sort_index
				from filtered_entities
			),
			entity_count as (
				select coalesce(max(total), 0)::integer as total
				from sorted_entities
			),
			paginated_entities as (
				select *
				from sorted_entities
				order by sort_index
				offset ${offset}
				limit ${input.request.pagination.limit}
			)
		select
			id,
			name,
			image,
			created_at,
			updated_at,
			external_id,
			entity_schema_id,
			sandbox_script_id,
			entity_schema_slug,
			entity_count.total,
			${resolvedFields} as fields
		from entity_count
		left join paginated_entities on true
		order by sort_index
	`);

	const total = dataResult.rows[0]?.total ?? 0;
	const pagination = calculatePagination({
		total,
		page: input.request.pagination.page,
		limit: input.request.pagination.limit,
	});

	return {
		meta: { pagination },
		items: dataResult.rows.flatMap((row) => {
			const item = mapQueryRowToItem(row);
			return item ? [item] : [];
		}),
	} satisfies QueryEngineResponse;
};
