import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "~/lib/db";
import { entity, entitySchema, type ImageSchemaType } from "~/lib/db/schema";
import type { EntitySchemaPropertiesShape } from "../entity-schemas/service";
import type { GridConfig, ListConfig } from "../saved-views/schemas";
import { ViewRuntimeNotFoundError, ViewRuntimeValidationError } from "./errors";
import { buildFilterWhereClause } from "./filter-builder";
import {
	buildSchemaMap,
	getPropertyType,
	type PropertyType,
	parseFieldPath,
} from "./schema-introspection";
import type { ViewRuntimeRequest, ViewRuntimeResponse } from "./schemas";

type ViewRuntimeSchemaRow = {
	id: string;
	slug: string;
	propertiesSchema: EntitySchemaPropertiesShape;
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
	total: number;
	limit: number;
	offset: number;
};

type PaginationResult = PaginationInput & {
	totalPages: number;
	currentPage: number;
	hasNextPage: boolean;
	hasPreviousPage: boolean;
};

type RuntimeRef =
	| { type: "top-level"; column: string }
	| { type: "schema-property"; slug: string; property: string };

const entitySchemaVisibleToUserClause = (userId: string) => {
	return or(isNull(entitySchema.userId), eq(entitySchema.userId, userId));
};

const resolveRuntimeReference = (
	reference: string,
	defaultSchemaSlug: string,
): RuntimeRef => {
	try {
		if (reference.startsWith("@")) {
			return parseFieldPath(reference);
		}
		if (reference.includes(".")) {
			return parseFieldPath(reference);
		}
	} catch (error) {
		throw new ViewRuntimeValidationError(
			error instanceof Error ? error.message : "Invalid field reference",
		);
	}

	return {
		property: reference,
		type: "schema-property",
		slug: defaultSchemaSlug,
	};
};

const getSchemaForReference = (
	schemaMap: Map<string, ViewRuntimeSchemaRow>,
	reference: Extract<RuntimeRef, { type: "schema-property" }>,
) => {
	const foundSchema = schemaMap.get(reference.slug);
	if (!foundSchema) {
		throw new ViewRuntimeValidationError(
			`Schema '${reference.slug}' is not part of this runtime request`,
		);
	}

	return foundSchema;
};

const getTopLevelSortType = (column: string): PropertyType => {
	switch (column) {
		case "name":
			return "string";
		case "createdAt":
		case "updatedAt":
			return "date";
		default:
			throw new ViewRuntimeValidationError(
				`Unsupported sort column '@${column}'`,
			);
	}
};

const getCommonSortType = (propertyTypes: PropertyType[]) => {
	const uniqueTypes = [...new Set(propertyTypes)];
	const firstType = uniqueTypes[0];
	if (!firstType) {
		return "string" satisfies PropertyType;
	}
	if (uniqueTypes.length === 1) {
		return firstType;
	}
	if (
		uniqueTypes.every((propertyType) =>
			["integer", "number"].includes(propertyType),
		)
	) {
		return "number" satisfies PropertyType;
	}

	return "string" satisfies PropertyType;
};

const buildPropertySortExpression = (input: {
	alias: string;
	targetType: PropertyType;
	schemaMap: Map<string, ViewRuntimeSchemaRow>;
	reference: Extract<RuntimeRef, { type: "schema-property" }>;
}) => {
	const foundSchema = getSchemaForReference(input.schemaMap, input.reference);
	const propertyType = getPropertyType(foundSchema, input.reference.property);
	if (!propertyType) {
		throw new ViewRuntimeValidationError(
			`Property '${input.reference.property}' not found in schema '${input.reference.slug}'`,
		);
	}

	const propertyText = sql`${sql.raw(input.alias)}.properties ->> ${input.reference.property}`;
	const propertyJson = sql`${sql.raw(input.alias)}.properties -> ${input.reference.property}`;

	const valueExpression = buildCastedValueExpression(input.targetType, {
		propertyJson,
		propertyText,
	});

	if (input.schemaMap.size === 1 && input.reference.slug === foundSchema.slug) {
		return valueExpression;
	}

	return sql`case when ${sql.raw(input.alias)}.entity_schema_slug = ${input.reference.slug} then ${valueExpression} else null end`;
};

const buildCastedValueExpression = (
	targetType: PropertyType,
	input: {
		propertyText: ReturnType<typeof sql>;
		propertyJson: ReturnType<typeof sql>;
	},
) => {
	switch (targetType) {
		case "integer":
			return sql`(${input.propertyText})::integer`;
		case "number":
			return sql`(${input.propertyText})::numeric`;
		case "boolean":
			return sql`(${input.propertyText})::boolean`;
		case "date":
			return sql`(${input.propertyText})::timestamp`;
		case "array":
		case "object":
			return input.propertyJson;
		default:
			return input.propertyText;
	}
};

const buildTopLevelSortExpression = (input: {
	alias: string;
	column: string;
	targetType: PropertyType;
}) => {
	const expression = (() => {
		switch (input.column) {
			case "name":
				return sql`${sql.raw(input.alias)}.name`;
			case "createdAt":
				return sql`${sql.raw(input.alias)}.created_at`;
			case "updatedAt":
				return sql`${sql.raw(input.alias)}.updated_at`;
			default:
				throw new ViewRuntimeValidationError(
					`Unsupported sort column '@${input.column}'`,
				);
		}
	})();

	switch (input.targetType) {
		case "integer":
			return sql`(${expression})::integer`;
		case "number":
			return sql`(${expression})::numeric`;
		case "boolean":
			return sql`(${expression})::boolean`;
		case "date":
			return sql`(${expression})::timestamp`;
		case "array":
		case "object":
			return sql`to_jsonb(${expression})`;
		default:
			return sql`(${expression})::text`;
	}
};

const getSortExpressionType = (input: {
	reference: string;
	defaultSchemaSlug: string;
	schemaMap: Map<string, ViewRuntimeSchemaRow>;
}) => {
	const parsedReference = resolveRuntimeReference(
		input.reference,
		input.defaultSchemaSlug,
	);

	if (parsedReference.type === "top-level") {
		return {
			parsedReference,
			propertyType: getTopLevelSortType(parsedReference.column),
		};
	}

	const foundSchema = getSchemaForReference(input.schemaMap, parsedReference);
	const propertyType = getPropertyType(foundSchema, parsedReference.property);
	if (!propertyType) {
		throw new ViewRuntimeValidationError(
			`Property '${parsedReference.property}' not found in schema '${parsedReference.slug}'`,
		);
	}

	return { parsedReference, propertyType };
};

const requireSchemaQualifiedSortFields = (
	field: string[],
	isMultiSchema: boolean,
) => {
	if (!isMultiSchema) {
		return;
	}

	for (const reference of field) {
		if (reference.startsWith("@") || reference.includes(".")) {
			continue;
		}

		throw new ViewRuntimeValidationError(
			"Schema-qualified sort fields are required for multi-schema requests",
		);
	}
};

const buildSortExpression = (input: {
	alias: string;
	field: string[];
	defaultSchemaSlug: string;
	schemaMap: Map<string, ViewRuntimeSchemaRow>;
}) => {
	requireSchemaQualifiedSortFields(
		input.field,
		new Set(input.schemaMap.keys()).size > 1,
	);
	const resolvedFields = input.field.map((reference) => {
		return getSortExpressionType({
			reference,
			schemaMap: input.schemaMap,
			defaultSchemaSlug: input.defaultSchemaSlug,
		});
	});
	const targetType = getCommonSortType(
		resolvedFields.map((field) => field.propertyType),
	);
	const expressions = resolvedFields.map((field) => {
		if (field.parsedReference.type === "top-level") {
			return buildTopLevelSortExpression({
				alias: input.alias,
				column: field.parsedReference.column,
				targetType,
			});
		}

		return buildPropertySortExpression({
			targetType,
			alias: input.alias,
			schemaMap: input.schemaMap,
			reference: field.parsedReference,
		});
	});

	if (expressions.length === 1) {
		return expressions[0] ?? sql`null`;
	}
	return sql`coalesce(${sql.join(expressions, sql`, `)})`;
};

const buildTopLevelDisplayExpression = (alias: string, column: string) => {
	switch (column) {
		case "name":
			return sql`to_jsonb(${sql.raw(alias)}.name)`;
		case "image":
			return sql`coalesce(${sql.raw(alias)}.image, 'null'::jsonb)`;
		case "createdAt":
			return sql`to_jsonb(${sql.raw(alias)}.created_at)`;
		case "updatedAt":
			return sql`to_jsonb(${sql.raw(alias)}.updated_at)`;
		default:
			throw new ViewRuntimeValidationError(
				`Unsupported display column '@${column}'`,
			);
	}
};

const buildDisplayValueExpression = (input: {
	alias: string;
	reference: string | null;
	defaultSchemaSlug: string;
	schemaMap: Map<string, ViewRuntimeSchemaRow>;
}) => {
	if (!input.reference) {
		return sql`'null'::jsonb`;
	}

	const parsedReference = resolveRuntimeReference(
		input.reference,
		input.defaultSchemaSlug,
	);
	if (parsedReference.type === "top-level") {
		return buildTopLevelDisplayExpression(input.alias, parsedReference.column);
	}

	const foundSchema = getSchemaForReference(input.schemaMap, parsedReference);
	if (!getPropertyType(foundSchema, parsedReference.property)) {
		throw new ViewRuntimeValidationError(
			`Property '${parsedReference.property}' not found in schema '${parsedReference.slug}'`,
		);
	}

	const propertyValue = sql`${sql.raw(input.alias)}.properties -> ${parsedReference.property}`;
	if (
		input.schemaMap.size === 1 &&
		parsedReference.slug === input.defaultSchemaSlug
	) {
		return propertyValue;
	}

	return sql`case when ${sql.raw(input.alias)}.entity_schema_slug = ${parsedReference.slug} then ${propertyValue} else null end`;
};

const normalizeReferences = (references: string[] | null) => {
	if (!references?.length) {
		return [null];
	}
	return references;
};

const buildCoalescedDisplayExpression = (input: {
	alias: string;
	schemaMap: Map<string, ViewRuntimeSchemaRow>;
	references: string[] | null;
	defaultSchemaSlug: string;
}) => {
	const expressions = normalizeReferences(input.references).map((reference) => {
		return buildDisplayValueExpression({
			reference,
			alias: input.alias,
			schemaMap: input.schemaMap,
			defaultSchemaSlug: input.defaultSchemaSlug,
		});
	});

	if (expressions.length === 1) {
		return expressions[0] ?? sql`null`;
	}
	return sql`coalesce(${sql.join(expressions, sql`, `)})`;
};

const buildResolvedPropertiesExpression = (input: {
	alias: string;
	request: ViewRuntimeRequest;
	schemaMap: Map<string, ViewRuntimeSchemaRow>;
	defaultSchemaSlug: string;
}) => {
	if (input.request.layout === "table") {
		const columnExpressions = input.request.displayConfiguration.columns.map(
			(column, index) => {
				return sql`jsonb_build_object(
					${sql.raw(`'column_${index}'::text`)},
					${buildCoalescedDisplayExpression({
						alias: input.alias,
						schemaMap: input.schemaMap,
						references: column.property,
						defaultSchemaSlug: input.defaultSchemaSlug,
					})}
				)`;
			},
		);

		if (!columnExpressions.length) {
			return sql`'{}'::jsonb`;
		}
		return sql.join(columnExpressions, sql` || `);
	}

	const displayConfiguration: GridConfig | ListConfig =
		input.request.displayConfiguration;

	return sql`jsonb_build_object(
		'imageProperty', ${buildCoalescedDisplayExpression({
			alias: input.alias,
			schemaMap: input.schemaMap,
			defaultSchemaSlug: input.defaultSchemaSlug,
			references: displayConfiguration.imageProperty,
		})},
		'titleProperty', ${buildCoalescedDisplayExpression({
			alias: input.alias,
			schemaMap: input.schemaMap,
			defaultSchemaSlug: input.defaultSchemaSlug,
			references: displayConfiguration.titleProperty,
		})},
		'subtitleProperty', ${buildCoalescedDisplayExpression({
			alias: input.alias,
			schemaMap: input.schemaMap,
			defaultSchemaSlug: input.defaultSchemaSlug,
			references: displayConfiguration.subtitleProperty,
		})},
		'badgeProperty', ${buildCoalescedDisplayExpression({
			alias: input.alias,
			schemaMap: input.schemaMap,
			defaultSchemaSlug: input.defaultSchemaSlug,
			references: displayConfiguration.badgeProperty,
		})}
	)`;
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
	const maxOffset = Math.max(0, input.total - input.limit);
	const offset = Math.min(input.offset, maxOffset);
	const totalPages =
		input.total === 0 ? 0 : Math.ceil(input.total / input.limit);
	const currentPage =
		input.total === 0 ? 1 : Math.floor(offset / input.limit) + 1;

	return {
		...input,
		offset,
		totalPages,
		currentPage,
		hasPreviousPage: offset > 0,
		hasNextPage: offset + input.limit < input.total,
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
		limit: request.page.limit,
		offset: request.page.offset,
	});
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
				offset ${pagination.offset}
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
