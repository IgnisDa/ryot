import { describe, expect, it } from "bun:test";
import { createEntityPropertyExpression } from "@ryot/ts-utils";
import { PgDialect } from "drizzle-orm/pg-core";
import {
	createSmartphoneSchema,
	createTabletSchema,
	literalExpression,
} from "~/lib/test-fixtures";
import { buildEventJoinMap, buildSchemaMap } from "~/lib/views/reference";
import { createScalarExpressionCompiler } from "./expression-compiler";
import { createExpressionTypeResolver } from "./expression-type-resolver";
import { buildPredicateClause } from "./predicate-clause-builder";
import type { QueryEngineContext } from "./schemas";

const dialect = new PgDialect();
const smartphoneSchema = createSmartphoneSchema();
const tabletSchema = createTabletSchema();
const schemaMap = buildSchemaMap([smartphoneSchema, tabletSchema]);
const context: QueryEngineContext = {
	schemaMap,
	eventJoinMap: buildEventJoinMap([]),
};

const createTestCompiler = (
	input: Omit<
		Parameters<typeof createScalarExpressionCompiler>[0],
		"getTypeInfo"
	>,
) => {
	const getTypeInfo = createExpressionTypeResolver({
		context: input.context,
		computedFields: input.computedFields,
	});
	return createScalarExpressionCompiler({ ...input, getTypeInfo });
};

describe("buildPredicateClause", () => {
	describe("isNull / isNotNull", () => {
		it("builds isNull predicate for entity properties", () => {
			const compiler = createTestCompiler({ context, alias: "entities" });

			const clause = buildPredicateClause({
				compiler: {
					compile: compiler.compile,
					getTypeInfo: () => ({ kind: "property", propertyType: "string" }),
				},
				predicate: {
					type: "isNull",
					expression: createEntityPropertyExpression(
						"smartphones",
						"nameplate",
					),
				},
			});

			const query = dialect.sqlToQuery(clause);
			expect(query.sql.toLowerCase()).toContain("is null");
		});

		it("builds isNotNull predicate for entity properties", () => {
			const compiler = createTestCompiler({ context, alias: "entities" });

			const clause = buildPredicateClause({
				compiler: {
					compile: compiler.compile,
					getTypeInfo: () => ({ kind: "property", propertyType: "string" }),
				},
				predicate: {
					type: "isNotNull",
					expression: createEntityPropertyExpression(
						"smartphones",
						"nameplate",
					),
				},
			});

			const query = dialect.sqlToQuery(clause);
			expect(query.sql.toLowerCase()).toContain("is not null");
		});
	});

	describe("and / or", () => {
		it("builds AND predicate from multiple predicates", () => {
			const compiler = createTestCompiler({ context, alias: "entities" });
			const getTypeInfo = createExpressionTypeResolver({
				context,
				computedFields: [],
			});

			const clause = buildPredicateClause({
				compiler: { compile: compiler.compile, getTypeInfo },
				predicate: {
					type: "and",
					predicates: [
						{
							operator: "eq",
							type: "comparison",
							right: literalExpression("test"),
							left: createEntityPropertyExpression("smartphones", "nameplate"),
						},
						{
							operator: "gte",
							type: "comparison",
							right: literalExpression(2020),
							left: createEntityPropertyExpression(
								"smartphones",
								"releaseYear",
							),
						},
					],
				},
			});

			const query = dialect.sqlToQuery(clause);
			expect(query.sql.toLowerCase()).toContain(" and ");
		});

		it("builds OR predicate from multiple predicates", () => {
			const compiler = createTestCompiler({ context, alias: "entities" });
			const getTypeInfo = createExpressionTypeResolver({
				context,
				computedFields: [],
			});

			const clause = buildPredicateClause({
				compiler: { compile: compiler.compile, getTypeInfo },
				predicate: {
					type: "or",
					predicates: [
						{
							operator: "eq",
							type: "comparison",
							right: literalExpression("a"),
							left: createEntityPropertyExpression("smartphones", "nameplate"),
						},
						{
							operator: "eq",
							type: "comparison",
							right: literalExpression("b"),
							left: createEntityPropertyExpression("smartphones", "nameplate"),
						},
					],
				},
			});

			const query = dialect.sqlToQuery(clause);
			expect(query.sql.toLowerCase()).toContain(" or ");
		});

		it("throws for empty and predicates", () => {
			const compiler = createTestCompiler({ context, alias: "entities" });

			expect(() =>
				buildPredicateClause({
					predicate: { type: "and", predicates: [] },
					compiler: {
						compile: compiler.compile,
						getTypeInfo: () => ({ kind: "property", propertyType: "string" }),
					},
				}),
			).toThrow("And predicates must not be empty");
		});

		it("throws for empty or predicates", () => {
			const compiler = createTestCompiler({ context, alias: "entities" });

			expect(() =>
				buildPredicateClause({
					predicate: { type: "or", predicates: [] },
					compiler: {
						compile: compiler.compile,
						getTypeInfo: () => ({ kind: "property", propertyType: "string" }),
					},
				}),
			).toThrow("Or predicates must not be empty");
		});
	});

	describe("not", () => {
		it("builds NOT predicate", () => {
			const compiler = createTestCompiler({ context, alias: "entities" });
			const getTypeInfo = createExpressionTypeResolver({
				context,
				computedFields: [],
			});

			const clause = buildPredicateClause({
				compiler: { compile: compiler.compile, getTypeInfo },
				predicate: {
					type: "not",
					predicate: {
						operator: "eq",
						type: "comparison",
						right: literalExpression("test"),
						left: createEntityPropertyExpression("smartphones", "nameplate"),
					},
				},
			});

			const query = dialect.sqlToQuery(clause);
			expect(query.sql.toLowerCase()).toContain("not");
		});
	});

	describe("in", () => {
		it("builds IN predicate with literal values", () => {
			const compiler = createTestCompiler({ context, alias: "entities" });
			const getTypeInfo = createExpressionTypeResolver({
				context,
				computedFields: [],
			});

			const clause = buildPredicateClause({
				compiler: { compile: compiler.compile, getTypeInfo },
				predicate: {
					type: "in",
					expression: createEntityPropertyExpression(
						"smartphones",
						"nameplate",
					),
					values: [
						literalExpression("a"),
						literalExpression("b"),
						literalExpression("c"),
					],
				},
			});

			const query = dialect.sqlToQuery(clause);
			expect(query.sql.toLowerCase()).toContain("in");
			expect(query.params).toContain("a");
			expect(query.params).toContain("b");
			expect(query.params).toContain("c");
		});
	});
});
