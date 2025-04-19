import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "~/lib/db";
import { entity, entitySchema, type ImageSchemaType } from "~/lib/db/schema";
import type { EntitySchemaPropertiesShape } from "../entity-schemas/service";
import { buildResolvedPropertiesExpression } from "./display-builder";
import { ViewRuntimeNotFoundError, ViewRuntimeValidationError } from "./errors";
import { buildFilterWhereClause } from "./filter-builder";
import type { ViewRuntimeSchemaLike } from "./runtime-reference";
import { buildSchemaMap } from "./schema-introspection";
import type { ViewRuntimeRequest, ViewRuntimeResponse } from "./schemas";
import { buildSortExpression } from "./sort-builder";

type ViewRuntimeSchemaRow = ViewRuntimeSchemaLike & {
	id: string;
};

type QueryRow = {
	id: string;
	name: string;
	created_at: Date;
	updated_at: Date;
	entity_schema_id: string;
	entity_schema_slug: string;
	image: ImageSchemaType | null;
	resolved_properties: Record<string, unknown>;
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

const getDefaultSchemaSlug = (slugs: string[]) => slugs[0] ?? "";

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

export const executeViewRuntimeQuery = async (
	request: ViewRuntimeRequest,
	userId: string,
): Promise<ViewRuntimeResponse> => {
	const runtimeSchemas = await fetchRuntimeSchemas({
		userId,
		entitySchemaSlugs: request.entitySchemaSlugs,
	});
	const defaultSchemaSlug = getDefaultSchemaSlug(request.entitySchemaSlugs);
	const schemaMap = buildSchemaMap(runtimeSchemas);
	const filterWhereClause = buildFilterWhereClause({
		schemaMap,
		alias: "entity",
		defaultSchemaSlug,
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
		defaultSchemaSlug,
		field: request.sort.field,
		alias: "filtered_entities",
	});

	const countResult = await db.execute<{ total: number }>(sql`
		with
			${filteredEntitiesCte},
			entity_count as (
				select count(*)::integer as total
				from filtered_entities
			)
		select total
		from entity_count
	`);

	const total = countResult.rows[0]?.total ?? 0;
	const pagination = calculatePagination({
		total,
		page: request.pagination.page,
		limit: request.pagination.limit,
	});

	if (total === 0 || pagination.page > pagination.totalPages) {
		return { items: [], meta: { pagination } };
	}

	const offset = (pagination.page - 1) * pagination.limit;
	const resolvedProperties = buildResolvedPropertiesExpression({
		request,
		schemaMap,
		defaultSchemaSlug,
		alias: "paginated_entities",
	});
	const direction = sql.raw(request.sort.direction.toUpperCase());

	const dataResult = await db.execute<QueryRow>(sql`
		with
			${filteredEntitiesCte},
			entity_count as (
				select count(*)::integer as total
				from filtered_entities
			),
			sorted_entities as (
				select
					filtered_entities.*,
					row_number() over (
						order by ${sortExpression} ${direction} nulls last, filtered_entities.id asc
					) as sort_index
				from filtered_entities
			),
			paginated_entities as (
				select *
				from sorted_entities
				order by sort_index
				offset ${offset}
				limit ${pagination.limit}
			)
		select
			id,
			name,
			image,
			created_at,
			updated_at,
			entity_schema_id,
			entity_schema_slug,
			${resolvedProperties} as resolved_properties
		from paginated_entities
		order by sort_index
	`);

	return {
		meta: { pagination },
		items: dataResult.rows.map((row) => ({
			id: row.id,
			name: row.name,
			image: row.image,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			entitySchemaId: row.entity_schema_id,
			entitySchemaSlug: row.entity_schema_slug,
			resolvedProperties: row.resolved_properties,
		})),
	};
};
