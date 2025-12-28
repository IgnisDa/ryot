import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "~/lib/db";
import { entity, entitySchema, type ImageSchemaType } from "~/lib/db/schema";
import {
	ViewRuntimeNotFoundError,
	ViewRuntimeValidationError,
} from "~/lib/views/errors";
import {
	buildSchemaMap,
	type ViewRuntimeSchemaLike,
} from "~/lib/views/reference";
import { validateViewRuntimeReferences } from "~/lib/views/validator";
import type { EntitySchemaPropertiesShape } from "../entity-schemas/service";
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

type ViewRuntimeSchemaRow = ViewRuntimeSchemaLike & {
	id: string;
};

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

const entitySchemaVisibleToUserClause = (userId: string) => {
	return or(isNull(entitySchema.userId), eq(entitySchema.userId, userId));
};

const buildFilteredEntitiesCte = (input: {
	userId: string;
	entitySchemaIds: string[];
	filterWhereClause?: ReturnType<typeof sql>;
}) => {
	const entitySchemaIdList = sql.join(
		input.entitySchemaIds.map((entitySchemaId) => sql`${entitySchemaId}`),
		sql`, `,
	);
	const filterClause = input.filterWhereClause
		? sql` and ${input.filterWhereClause}`
		: sql``;

	return sql`
		filtered_entities as (
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
				${filterClause}
		)
	`;
};

const fetchRuntimeSchemas = async (input: {
	userId: string;
	entitySchemaSlugs: string[];
}) => {
	const uniqueSlugs = [...new Set(input.entitySchemaSlugs)];
	const rows = await db
		.select({
			id: entitySchema.id,
			slug: entitySchema.slug,
			propertiesSchema: entitySchema.propertiesSchema,
		})
		.from(entitySchema)
		.where(
			and(
				inArray(entitySchema.slug, uniqueSlugs),
				entitySchemaVisibleToUserClause(input.userId),
			),
		);

	const schemas = rows.map((row) => ({
		...row,
		propertiesSchema: row.propertiesSchema as EntitySchemaPropertiesShape,
	}));
	const schemasBySlug = new Map<string, ViewRuntimeSchemaRow[]>();
	for (const schema of schemas) {
		const existingSchemas = schemasBySlug.get(schema.slug) ?? [];
		existingSchemas.push(schema);
		schemasBySlug.set(schema.slug, existingSchemas);
	}

	const foundSchemaSlugs = new Set(schemasBySlug.keys());
	for (const slug of uniqueSlugs) {
		if (!foundSchemaSlugs.has(slug)) {
			throw new ViewRuntimeNotFoundError(`Schema '${slug}' not found`);
		}

		if ((schemasBySlug.get(slug)?.length ?? 0) > 1) {
			throw new ViewRuntimeValidationError(
				`Schema '${slug}' resolves to multiple visible schemas`,
			);
		}
	}

	return schemas;
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

export const executeViewRuntimeQuery = async (
	request: ViewRuntimeRequest,
	userId: string,
): Promise<ViewRuntimeResponse> => {
	const runtimeSchemas = await fetchRuntimeSchemas({
		userId,
		entitySchemaSlugs: request.entitySchemaSlugs,
	});
	const schemaMap = buildSchemaMap(runtimeSchemas);
	validateViewRuntimeReferences(request, schemaMap);
	const filterWhereClause = buildFilterWhereClause({
		schemaMap,
		alias: "entity",
		filters: request.filters,
		entitySchemaSlugs: request.entitySchemaSlugs,
		schemaSlugExpression: sql`${entitySchema.slug}`,
	});
	const filteredEntitiesCte = buildFilteredEntitiesCte({
		userId,
		filterWhereClause,
		entitySchemaIds: runtimeSchemas.map((schema) => schema.id),
	});
	const sortExpression = buildSortExpression({
		schemaMap,
		field: request.sort.fields,
		alias: "filtered_entities",
	});
	const offset = (request.pagination.page - 1) * request.pagination.limit;
	const resolvedProperties =
		request.layout === "table"
			? sql`null::jsonb`
			: buildResolvedPropertiesExpression({
					request,
					schemaMap,
					alias: "paginated_entities",
				});
	const cells =
		request.layout === "table"
			? buildTableCellsExpression({
					request,
					schemaMap,
					alias: "paginated_entities",
				})
			: sql`null::jsonb`;
	const direction = sql.raw(request.sort.direction.toUpperCase());

	const dataResult = await db.execute<QueryRow>(sql`
		with
			${filteredEntitiesCte},
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
				limit ${request.pagination.limit}
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
		page: request.pagination.page,
		limit: request.pagination.limit,
	});

	if (request.layout === "table") {
		return {
			meta: { pagination, table: buildTableMeta(request) },
			items: dataResult.rows.flatMap((row) => {
				const item = mapQueryRowToItem(row, request.layout);
				return item && "cells" in item ? [item] : [];
			}),
		} satisfies ViewRuntimeTableResponse;
	}

	return {
		meta: { pagination },
		items: dataResult.rows.flatMap((row) => {
			const item = mapQueryRowToItem(row, request.layout);
			return item && "resolvedProperties" in item ? [item] : [];
		}),
	} satisfies ViewRuntimeSemanticResponse;
};
