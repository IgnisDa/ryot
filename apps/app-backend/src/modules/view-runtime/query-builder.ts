import { sql } from "drizzle-orm";
import { db } from "~/lib/db";
import {
	entity,
	entitySchema,
	event,
	type ImageSchemaType,
} from "~/lib/db/schema";
import type {
	ViewRuntimeEventJoinLike,
	ViewRuntimeReferenceContext,
	ViewRuntimeSchemaLike,
} from "~/lib/views/reference";
import {
	buildResolvedPropertiesExpression,
	buildTableCellsExpression,
} from "./display-builder";
import { buildFilterWhereClause } from "./filter-builder";
import type {
	ViewRuntimeRequest,
	ViewRuntimeResponse,
	ViewRuntimeSemanticItem,
	ViewRuntimeSemanticResponse,
	ViewRuntimeTableItem,
	ViewRuntimeTableMeta,
	ViewRuntimeTableResponse,
} from "./schemas";
import { buildSortExpression } from "./sort-builder";

export type ViewRuntimeSchemaRow = ViewRuntimeSchemaLike & {
	id: string;
};

export type ViewRuntimePreparedEventJoin = ViewRuntimeEventJoinLike;

type QueryRow = {
	total: number;
	id: string | null;
	name: string | null;
	created_at: Date | null;
	updated_at: Date | null;
	image: ImageSchemaType | null;
	entity_schema_id: string | null;
	entity_schema_slug: string | null;
	cells: ViewRuntimeTableItem["cells"] | null;
	resolved_properties: ViewRuntimeSemanticItem["resolvedProperties"] | null;
};

type ViewRuntimeItem = ViewRuntimeResponse["items"][number];

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
	entitySchemaIds: string[];
}) => {
	const entitySchemaIdList = sql.join(
		input.entitySchemaIds.map((entitySchemaId) => sql`${entitySchemaId}`),
		sql`, `,
	);

	return sql`
		base_entities as (
			select
				${entity.id} as id,
				${entity.name} as name,
				${entity.image} as image,
				${entity.createdAt} as created_at,
				${entity.updatedAt} as updated_at,
				${entity.properties} as properties,
				${entity.entitySchemaId} as entity_schema_id,
				${entitySchema.slug} as entity_schema_slug
			from ${entity}
			inner join ${entitySchema}
				on ${entity.entitySchemaId} = ${entitySchema.id}
			where ${entity.userId} = ${input.userId}
				and ${entity.entitySchemaId} in (${entitySchemaIdList})
		)
	`;
};

const buildLatestEventJoinCte = (input: {
	join: ViewRuntimePreparedEventJoin;
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

const buildJoinedEntitiesCte = (eventJoins: ViewRuntimePreparedEventJoin[]) => {
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

const buildTableMeta = (
	request: Extract<ViewRuntimeRequest, { layout: "table" }>,
): ViewRuntimeTableMeta => ({
	columns: request.displayConfiguration.columns.map((column, index) => ({
		label: column.label,
		key: `column_${index}`,
	})),
});

export const mapQueryRowToItem = (
	row: QueryRow,
	layout: ViewRuntimeRequest["layout"],
): ViewRuntimeItem | null => {
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
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		entitySchemaId: row.entity_schema_id,
		entitySchemaSlug: row.entity_schema_slug,
	};

	if (layout === "table") {
		if (row.cells === null) {
			return null;
		}

		return {
			...baseItem,
			cells: row.cells,
		} satisfies ViewRuntimeTableItem;
	}

	if (row.resolved_properties === null) {
		return null;
	}

	return {
		...baseItem,
		resolvedProperties: row.resolved_properties,
	} satisfies ViewRuntimeSemanticItem;
};

export const executePreparedViewQuery = async (input: {
	userId: string;
	request: ViewRuntimeRequest;
	runtimeSchemas: ViewRuntimeSchemaRow[];
	eventJoins: ViewRuntimePreparedEventJoin[];
	schemaMap: Map<string, ViewRuntimeSchemaRow>;
	eventJoinMap: Map<string, ViewRuntimePreparedEventJoin>;
}): Promise<ViewRuntimeResponse> => {
	const context: ViewRuntimeReferenceContext<
		ViewRuntimeSchemaRow,
		ViewRuntimePreparedEventJoin
	> = {
		schemaMap: input.schemaMap,
		eventJoinMap: input.eventJoinMap,
	};
	const filterWhereClause = buildFilterWhereClause({
		context,
		alias: "joined_entities",
		filters: input.request.filters,
		entitySchemaSlugs: input.request.entitySchemaSlugs,
		schemaSlugExpression: sql`${sql.raw("joined_entities")}.entity_schema_slug`,
	});
	const baseEntitiesCte = buildBaseEntitiesCte({
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
		field: input.request.sort.fields,
	});
	const offset =
		(input.request.pagination.page - 1) * input.request.pagination.limit;
	const resolvedProperties =
		input.request.layout === "table"
			? sql`null::jsonb`
			: buildResolvedPropertiesExpression({
					context,
					request: input.request,
					alias: "paginated_entities",
				});
	const cells =
		input.request.layout === "table"
			? buildTableCellsExpression({
					context,
					request: input.request,
					alias: "paginated_entities",
				})
			: sql`null::jsonb`;
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
			entity_schema_id,
			entity_schema_slug,
			entity_count.total,
			${resolvedProperties} as resolved_properties,
			${cells} as cells
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

	if (input.request.layout === "table") {
		return {
			meta: { pagination, table: buildTableMeta(input.request) },
			items: dataResult.rows.flatMap((row) => {
				const item = mapQueryRowToItem(row, input.request.layout);
				return item && "cells" in item ? [item] : [];
			}),
		} satisfies ViewRuntimeTableResponse;
	}

	return {
		meta: { pagination },
		items: dataResult.rows.flatMap((row) => {
			const item = mapQueryRowToItem(row, input.request.layout);
			return item && "resolvedProperties" in item ? [item] : [];
		}),
	} satisfies ViewRuntimeSemanticResponse;
};
