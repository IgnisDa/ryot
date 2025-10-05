import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
	createEntityColumnExpression,
	createEntityPropertyExpression,
	createEntitySchemaExpression,
	createLiteralExpression,
	type QueryExpression,
	type QueryFilter,
} from "~/lib/query-language";
import { buildEventJoinMap, buildSchemaMap } from "~/lib/views/reference";

import { buildResolvedFieldsExpression } from "./display-sql-builder";
import { createQueryCompiler, createScalarExpressionCompiler } from "./expression-compiler";
import { createExpressionTypeResolver } from "./expression-type-resolver";
import { buildFilterWhereClause } from "./filter-builder";
import { buildPaginatedQuerySql } from "./paginated-query-sql";
import { ENTITY_CTE_ALIASES, EVENT_CTE_ALIASES } from "./query-cte-shared";
import type { QueryEngineSchemaRow } from "./query-cte-shared";
import { buildSortExpression } from "./sort-builder";

const dialect = new PgDialect();

const smartphoneSchema = {
	id: "schema_smartphones",
	slug: "smartphones",
	propertiesSchema: {
		fields: {
			nameplate: {
				type: "string" as const,
				label: "Nameplate",
				description: "Model name",
			},
			releaseYear: {
				type: "integer" as const,
				label: "Release Year",
				description: "Device release year",
			},
		},
	},
} satisfies QueryEngineSchemaRow;

const tabletSchema = {
	id: "schema_tablets",
	slug: "tablets",
	propertiesSchema: {
		fields: {
			nameplate: {
				type: "string" as const,
				label: "Nameplate",
				description: "Model name",
			},
			releaseYear: {
				type: "integer" as const,
				label: "Release Year",
				description: "Device release year",
			},
		},
	},
} satisfies QueryEngineSchemaRow;

const createComputedFieldExpression = (key: string): QueryExpression => ({
	type: "reference",
	reference: { key, type: "computed-field" },
});

const comparisonPredicate = (
	left: QueryExpression,
	operator: Extract<QueryFilter, { type: "comparison" }>["operator"],
	right: QueryExpression,
): QueryFilter => ({ left, right, operator, type: "comparison" });

describe("query SQL integration", () => {
	describe("entity mode full pipeline", () => {
		it("propagates filter params, sort column, and display fields through a single compiled query", () => {
			const schemaMap = buildSchemaMap([smartphoneSchema, tabletSchema]);
			const context = { schemaMap, eventJoinMap: buildEventJoinMap([]) };
			const computedFields = [
				{
					key: "yearLabel",
					expression: {
						type: "concat" as const,
						values: [
							createLiteralExpression("Year: "),
							createEntityPropertyExpression("smartphones", "releaseYear"),
						],
					},
				},
			];

			const getTypeInfo = createExpressionTypeResolver({
				context,
				computedFields,
			});

			const filterCompiler = createQueryCompiler({
				context,
				getTypeInfo,
				computedFields,
				alias: ENTITY_CTE_ALIASES.joined,
			});
			const filterClause = buildFilterWhereClause({
				context,
				computedFields,
				compiler: filterCompiler,
				predicate: comparisonPredicate(
					createEntityPropertyExpression("smartphones", "releaseYear"),
					"gte",
					createLiteralExpression(2020),
				),
			});

			const sortCompiler = createQueryCompiler({
				context,
				getTypeInfo,
				computedFields,
				alias: ENTITY_CTE_ALIASES.filtered,
			});
			const sortExpression = buildSortExpression({
				context,
				computedFields,
				compiler: sortCompiler,
				expression: createEntityPropertyExpression("smartphones", "releaseYear"),
			});

			const resolvedFields = buildResolvedFieldsExpression({
				context,
				getTypeInfo,
				computedFields,
				alias: ENTITY_CTE_ALIASES.paginated,
				fields: [
					{
						key: "name",
						expression: createEntityPropertyExpression("smartphones", "nameplate"),
					},
					{
						key: "yearLabel",
						expression: createComputedFieldExpression("yearLabel"),
					},
					{ key: "schema", expression: createEntitySchemaExpression("name") },
				],
			});

			const fullSql = buildPaginatedQuerySql({
				offset: 0,
				limit: 20,
				filterClause,
				sortExpression,
				resolvedFields,
				rowIdColumn: "id",
				countAlias: ENTITY_CTE_ALIASES.count,
				sortedAlias: ENTITY_CTE_ALIASES.sorted,
				filteredAlias: ENTITY_CTE_ALIASES.filtered,
				joinedTableName: ENTITY_CTE_ALIASES.joined,
				paginatedAlias: ENTITY_CTE_ALIASES.paginated,
				direction: sql.raw("DESC"),
				withCtes: [sql.raw("placeholder_cte as (select 1)")],
			});

			const { sql: compiledSql, params } = dialect.sqlToQuery(fullSql);

			expect(params).toContain(2020);
			expect(params).toContain("releaseYear");
			expect(params).toContain("nameplate");
			expect(params).toContain("name");

			expect(compiledSql).toContain("joined_entities");
			expect(compiledSql).toContain("filtered_entities");
			expect(compiledSql).toContain("paginated_entities");
		});

		it("compiles computed fields through a shared type resolver without redundant SQL fragments", () => {
			const schemaMap = buildSchemaMap([smartphoneSchema]);
			const context = { schemaMap, eventJoinMap: buildEventJoinMap([]) };
			const computedFields = [
				{
					key: "decade",
					expression: {
						type: "arithmetic" as const,
						operator: "multiply" as const,
						left: {
							type: "floor" as const,
							expression: {
								type: "arithmetic" as const,
								operator: "divide" as const,
								left: createEntityPropertyExpression("smartphones", "releaseYear"),
								right: createLiteralExpression(10),
							},
						},
						right: createLiteralExpression(10),
					},
				},
			];

			const getTypeInfo = createExpressionTypeResolver({
				context,
				computedFields,
			});
			const filterCompiler = createQueryCompiler({
				context,
				getTypeInfo,
				computedFields,
				alias: ENTITY_CTE_ALIASES.joined,
			});
			const sortCompiler = createQueryCompiler({
				context,
				getTypeInfo,
				computedFields,
				alias: ENTITY_CTE_ALIASES.filtered,
			});

			const filterClause = buildFilterWhereClause({
				context,
				computedFields,
				compiler: filterCompiler,
				predicate: comparisonPredicate(
					createComputedFieldExpression("decade"),
					"eq",
					createLiteralExpression(2020),
				),
			});
			const sortExpr = buildSortExpression({
				context,
				computedFields,
				compiler: sortCompiler,
				expression: createComputedFieldExpression("decade"),
			});

			const filterSql = dialect.sqlToQuery(filterClause).sql;
			const sortSql = dialect.sqlToQuery(sortExpr).sql;

			expect(filterSql).toContain("floor(");
			expect(sortSql).toContain("floor(");
			expect(filterSql).toContain("joined_entities.properties");
			expect(sortSql).toContain("filtered_entities.properties");
		});
	});

	describe("event mode column overrides", () => {
		it("references entity_properties instead of properties for entity refs in event mode", () => {
			const schemaMap = buildSchemaMap([smartphoneSchema]);
			const context = {
				schemaMap,
				eventJoinMap: buildEventJoinMap([]),
				entityColumnOverrides: {
					id: "entity_id",
					properties: "entity_properties",
					created_at: "entity_created_at",
					updated_at: "entity_updated_at",
				},
			};

			const getTypeInfo = createExpressionTypeResolver({ context });
			const { compile } = createScalarExpressionCompiler({
				context,
				getTypeInfo,
				alias: EVENT_CTE_ALIASES.paginated,
			});

			const compiled = compile(createEntityPropertyExpression("smartphones", "nameplate"));
			const { sql: compiledSql } = dialect.sqlToQuery(compiled);

			expect(compiledSql).toContain("paginated_events.entity_properties");
			expect(compiledSql).not.toContain("paginated_events.properties");
		});

		it("uses entity_id instead of id for entity references in event mode", () => {
			const schemaMap = buildSchemaMap([smartphoneSchema]);
			const context = {
				schemaMap,
				eventJoinMap: buildEventJoinMap([]),
				entityColumnOverrides: {
					id: "entity_id",
					properties: "entity_properties",
					created_at: "entity_created_at",
					updated_at: "entity_updated_at",
				},
			};

			const getTypeInfo = createExpressionTypeResolver({ context });
			const { compile } = createScalarExpressionCompiler({
				context,
				getTypeInfo,
				alias: EVENT_CTE_ALIASES.paginated,
			});

			const compiled = compile(createEntityColumnExpression("smartphones", "id"));
			const { sql: compiledSql } = dialect.sqlToQuery(compiled);

			expect(compiledSql).toContain("paginated_events.entity_id");
			expect(compiledSql).not.toContain("paginated_events.id");
		});
	});
});
