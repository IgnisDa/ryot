import { describe, expect, it } from "bun:test";
import {
	createComputedFieldExpression,
	createEntityPropertyExpression,
	createEntitySchemaExpression,
} from "@ryot/ts-utils";
import { PgDialect } from "drizzle-orm/pg-core";
import {
	comparisonPredicate,
	createSmartphoneSchema,
	createTabletSchema,
	literalExpression,
} from "~/lib/test-fixtures";
import { buildEventJoinMap, buildSchemaMap } from "~/lib/views/reference";
import { buildResolvedFieldsExpression } from "./display-builder";
import { createScalarExpressionCompiler } from "./expression-compiler";
import { createExpressionTypeResolver } from "./expression-type-resolver";
import { buildFilterWhereClause } from "./filter-builder";
import { buildPaginatedQuerySql } from "./paginated-query-sql";
import { ENTITY_CTE_ALIASES, EVENT_CTE_ALIASES } from "./query-cte-shared";
import { buildSortExpression } from "./sort-builder";
import { buildLiteralExpression } from "./sql-expression-helpers";

const dialect = new PgDialect();
const smartphoneSchema = createSmartphoneSchema();
const tabletSchema = createTabletSchema();

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
							literalExpression("Year: "),
							createEntityPropertyExpression("smartphones", "releaseYear"),
						],
					},
				},
			];

			const getTypeInfo = createExpressionTypeResolver({
				context,
				computedFields,
			});
			const createCompiler = (alias: string) => {
				const { compile } = createScalarExpressionCompiler({
					alias,
					context,
					getTypeInfo,
					computedFields,
				});
				return { compile, getTypeInfo };
			};

			const filterCompiler = createCompiler(ENTITY_CTE_ALIASES.joined);
			const filterClause = buildFilterWhereClause({
				context,
				computedFields,
				compiler: filterCompiler,
				alias: ENTITY_CTE_ALIASES.joined,
				predicate: comparisonPredicate(
					createEntityPropertyExpression("smartphones", "releaseYear"),
					"gte",
					literalExpression(2020),
				),
			});

			const sortCompiler = createCompiler(ENTITY_CTE_ALIASES.filtered);
			const sortExpression = buildSortExpression({
				context,
				computedFields,
				compiler: sortCompiler,
				alias: ENTITY_CTE_ALIASES.filtered,
				expression: createEntityPropertyExpression(
					"smartphones",
					"releaseYear",
				),
			});

			const resolvedFields = buildResolvedFieldsExpression({
				context,
				getTypeInfo,
				computedFields,
				alias: ENTITY_CTE_ALIASES.paginated,
				fields: [
					{
						key: "name",
						expression: createEntityPropertyExpression(
							"smartphones",
							"nameplate",
						),
					},
					{
						key: "yearLabel",
						expression: createComputedFieldExpression("yearLabel"),
					},
					{ key: "schema", expression: createEntitySchemaExpression("name") },
				],
			});

			if (!filterClause) {
				throw new Error("Expected filter clause to be defined");
			}

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
				direction: buildLiteralExpression("DESC"),
				withCtes: [buildLiteralExpression("placeholder_cte")],
			});

			const { sql, params } = dialect.sqlToQuery(fullSql);

			expect(params).toContain(2020);
			expect(params).toContain("releaseYear");
			expect(params).toContain("nameplate");
			expect(params).toContain("name");

			expect(sql).toContain("joined_entities");
			expect(sql).toContain("filtered_entities");
			expect(sql).toContain("paginated_entities");
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
								left: createEntityPropertyExpression(
									"smartphones",
									"releaseYear",
								),
								right: literalExpression(10),
							},
						},
						right: literalExpression(10),
					},
				},
			];

			const getTypeInfo = createExpressionTypeResolver({
				context,
				computedFields,
			});
			const filterCompiler = (() => {
				const { compile } = createScalarExpressionCompiler({
					context,
					getTypeInfo,
					computedFields,
					alias: "joined_entities",
				});
				return { compile, getTypeInfo };
			})();
			const sortCompiler = (() => {
				const { compile } = createScalarExpressionCompiler({
					context,
					getTypeInfo,
					computedFields,
					alias: "filtered_entities",
				});
				return { compile, getTypeInfo };
			})();

			const filterClause = buildFilterWhereClause({
				context,
				computedFields,
				compiler: filterCompiler,
				alias: "joined_entities",
				predicate: comparisonPredicate(
					createComputedFieldExpression("decade"),
					"eq",
					literalExpression(2020),
				),
			});
			const sortExpr = buildSortExpression({
				context,
				computedFields,
				compiler: sortCompiler,
				alias: "filtered_entities",
				expression: createComputedFieldExpression("decade"),
			});

			if (!filterClause) {
				throw new Error("Expected filter clause for computed field predicate");
			}

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

			const compiled = compile(
				createEntityPropertyExpression("smartphones", "nameplate"),
			);
			const { sql } = dialect.sqlToQuery(compiled);

			expect(sql).toContain("paginated_events.entity_properties");
			expect(sql).not.toContain("paginated_events.properties");
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

			const compiled = compile({
				type: "reference",
				reference: { type: "entity", slug: "smartphones", path: ["id"] },
			});
			const { sql } = dialect.sqlToQuery(compiled);

			expect(sql).toContain("paginated_events.entity_id");
			expect(sql).not.toContain("paginated_events.id");
		});
	});
});
