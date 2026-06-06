import { describe, expect, it } from "vitest";

import { createEntityPropertyExpression, createLiteralExpression } from "#lib/query-language";

import { buildPredicateClause } from "./predicate-clause-builder";
import { comparison, context, createQueryTestCompiler, dialect } from "./test-support";

describe("buildPredicateClause", () => {
	it("builds isNull predicates for entity properties", () => {
		const compiler = createQueryTestCompiler({ alias: "entities", context });

		const clause = buildPredicateClause({
			compiler,
			predicate: {
				type: "isNull",
				expression: createEntityPropertyExpression("smartphones", "nameplate"),
			},
		});

		expect(dialect.sqlToQuery(clause).sql.toLowerCase()).toContain("is null");
	});

	it("builds isNotNull predicates for entity properties", () => {
		const compiler = createQueryTestCompiler({ alias: "entities", context });

		const clause = buildPredicateClause({
			compiler,
			predicate: {
				type: "isNotNull",
				expression: createEntityPropertyExpression("smartphones", "nameplate"),
			},
		});

		expect(dialect.sqlToQuery(clause).sql.toLowerCase()).toContain("is not null");
	});

	it("builds AND predicates from multiple predicates", () => {
		const compiler = createQueryTestCompiler({ alias: "entities", context });

		const clause = buildPredicateClause({
			compiler,
			predicate: {
				type: "and",
				predicates: [
					comparison(
						createEntityPropertyExpression("smartphones", "nameplate"),
						"eq",
						createLiteralExpression("test"),
					),
					comparison(
						createEntityPropertyExpression("smartphones", "releaseYear"),
						"gte",
						createLiteralExpression(2020),
					),
				],
			},
		});

		expect(dialect.sqlToQuery(clause).sql.toLowerCase()).toContain(" and ");
	});

	it("builds OR predicates from multiple predicates", () => {
		const compiler = createQueryTestCompiler({ alias: "entities", context });

		const clause = buildPredicateClause({
			compiler,
			predicate: {
				type: "or",
				predicates: [
					comparison(
						createEntityPropertyExpression("smartphones", "nameplate"),
						"eq",
						createLiteralExpression("a"),
					),
					comparison(
						createEntityPropertyExpression("smartphones", "nameplate"),
						"eq",
						createLiteralExpression("b"),
					),
				],
			},
		});

		expect(dialect.sqlToQuery(clause).sql.toLowerCase()).toContain(" or ");
	});

	it("throws for empty and predicates", () => {
		const compiler = createQueryTestCompiler({ alias: "entities", context });

		expect(() =>
			buildPredicateClause({
				compiler,
				predicate: { type: "and", predicates: [] },
			}),
		).toThrow("And predicates must not be empty");
	});

	it("throws for empty or predicates", () => {
		const compiler = createQueryTestCompiler({ alias: "entities", context });

		expect(() =>
			buildPredicateClause({
				compiler,
				predicate: { type: "or", predicates: [] },
			}),
		).toThrow("Or predicates must not be empty");
	});

	it("builds NOT predicates", () => {
		const compiler = createQueryTestCompiler({ alias: "entities", context });

		const clause = buildPredicateClause({
			compiler,
			predicate: {
				type: "not",
				predicate: comparison(
					createEntityPropertyExpression("smartphones", "nameplate"),
					"eq",
					createLiteralExpression("test"),
				),
			},
		});

		expect(dialect.sqlToQuery(clause).sql.toLowerCase()).toContain("not");
	});

	it("builds IN predicates with literal values", () => {
		const compiler = createQueryTestCompiler({ alias: "entities", context });

		const clause = buildPredicateClause({
			compiler,
			predicate: {
				type: "in",
				expression: createEntityPropertyExpression("smartphones", "nameplate"),
				values: [
					createLiteralExpression("a"),
					createLiteralExpression("b"),
					createLiteralExpression("c"),
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
