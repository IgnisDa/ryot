import { describe, expect, it } from "vitest";

import {
	createEntityPropertyExpression,
	createLiteralExpression,
	type QueryComputedField,
	type QueryFilter,
} from "#lib/query-language";

import { buildFilterWhereClause } from "./filter-builder";
import {
	comparison,
	context,
	createComputedFieldExpression,
	createEventJoinPropertyExpression,
	createQueryTestCompiler,
	dialect,
} from "./test-support";

const serializeClause = (
	predicate: QueryFilter,
	computedFields?: ReadonlyArray<QueryComputedField>,
) => {
	const compiler = createQueryTestCompiler({
		alias: "entities",
		context,
		computedFields,
	});
	return dialect.sqlToQuery(
		buildFilterWhereClause({ compiler, context, predicate, computedFields }),
	);
};

describe("buildFilterWhereClause", () => {
	it("builds comparison predicates for schema properties", () => {
		const clause = serializeClause(
			comparison(
				createEntityPropertyExpression("smartphones", "manufacturer"),
				"eq",
				createLiteralExpression("Apple"),
			),
		);

		expect(clause.sql).toContain("entities.properties ->>");
		expect(clause.params).toContain("manufacturer");
		expect(clause.params).toContain("Apple");
	});

	it("casts integer comparisons before evaluation", () => {
		const clause = serializeClause(
			comparison(
				createEntityPropertyExpression("smartphones", "releaseYear"),
				"eq",
				createLiteralExpression(2023),
			),
		);

		expect(clause.sql).toContain("::integer");
		expect(clause.params).toContain(2023);
	});

	it("truncates integer normalization instead of rounding", () => {
		const clause = serializeClause(
			comparison(
				{
					type: "integer",
					expression: {
						left: createLiteralExpression(13.75),
						right: createLiteralExpression(2),
						type: "arithmetic",
						operator: "divide",
					},
				},
				"eq",
				createLiteralExpression(6),
			),
		);

		expect(clause.sql.toLowerCase()).toContain("trunc(");
		expect(clause.params).toContain(13.75);
		expect(clause.params).toContain(6);
	});

	it("supports computed-field references inside predicates", () => {
		const clause = serializeClause(
			comparison(
				createComputedFieldExpression("makerLabel"),
				"eq",
				createLiteralExpression("Apple"),
			),
			[
				{
					key: "makerLabel",
					expression: createEntityPropertyExpression("smartphones", "manufacturer"),
				},
			],
		);

		expect(clause.sql).toContain("entities.properties ->>");
		expect(clause.params).toContain("manufacturer");
		expect(clause.params).toContain("Apple");
	});

	it("supports nested boolean predicates", () => {
		const clause = serializeClause({
			type: "and",
			predicates: [
				comparison(
					createEntityPropertyExpression("smartphones", "releaseYear"),
					"gte",
					createLiteralExpression(2020),
				),
				{
					type: "or",
					predicates: [
						comparison(
							createEntityPropertyExpression("smartphones", "manufacturer"),
							"eq",
							createLiteralExpression("Apple"),
						),
						comparison(
							createEntityPropertyExpression("tablets", "maker"),
							"eq",
							createLiteralExpression("Apple"),
						),
					],
				},
			],
		});

		expect(clause.sql.toLowerCase()).toContain(" and ");
		expect(clause.sql.toLowerCase()).toContain(" or ");
		expect(clause.sql).toContain("entity_schema_data");
	});

	it("builds null-check predicates", () => {
		const nullClause = serializeClause({
			type: "isNull",
			expression: createEntityPropertyExpression("smartphones", "manufacturer"),
		});
		const notNullClause = serializeClause({
			type: "isNotNull",
			expression: createEntityPropertyExpression("smartphones", "manufacturer"),
		});

		expect(nullClause.sql.toLowerCase()).toContain(" is null");
		expect(notNullClause.sql.toLowerCase()).toContain(" is not null");
	});

	it("builds contains predicates for string expressions", () => {
		const clause = serializeClause({
			type: "contains",
			value: createLiteralExpression("Apple"),
			expression: createEntityPropertyExpression("smartphones", "manufacturer"),
		});

		expect(clause.sql.toLowerCase()).toContain("ilike");
		expect(clause.sql.toLowerCase()).toContain("escape '\\'");
	});

	it("builds contains predicates for array expressions", () => {
		const clause = serializeClause({
			type: "contains",
			value: createLiteralExpression("sci-fi"),
			expression: createEntityPropertyExpression("smartphones", "tags"),
		});

		expect(clause.sql).toContain("@>");
		expect(clause.sql).toContain("jsonb_build_array");
	});

	it("treats jsonb null object expressions as null for null checks", () => {
		const clause = serializeClause({
			type: "isNull",
			expression: createEntityPropertyExpression("smartphones", "metadata"),
		});

		expect(clause.sql.toLowerCase()).toContain("nullif");
		expect(clause.sql).toContain("'null'::jsonb");
	});

	it("builds joined latest-event predicates", () => {
		const clause = serializeClause(
			comparison(
				createEventJoinPropertyExpression("review", "rating"),
				"gte",
				createLiteralExpression(4),
			),
		);

		expect(clause.sql).toContain("event_join_review");
		expect(clause.params).toContain("properties");
		expect(clause.params).toContain("rating");
		expect(clause.params).toContain(4);
	});

	it("filters by relationship built-ins and properties", () => {
		const builtInClause = serializeClause(
			comparison(
				{
					type: "reference",
					reference: {
						type: "relationship-join",
						joinKey: "ownership",
						path: ["createdAt"],
					},
				},
				"gte",
				createLiteralExpression("2024-01-01T00:00:00.000Z"),
			),
		);
		const propertyClause = serializeClause(
			comparison(
				{
					type: "reference",
					reference: {
						type: "relationship-join",
						joinKey: "ownership",
						path: ["properties", "rating"],
					},
				},
				"gte",
				createLiteralExpression(3),
			),
		);

		expect(builtInClause.sql).toContain("relationship_join_ownership");
		expect(builtInClause.params).toContain("createdAt");
		expect(propertyClause.sql).toContain("relationship_join_ownership");
		expect(propertyClause.params).toContain("rating");
	});

	it("filters by relationship array properties with contains", () => {
		const clause = serializeClause({
			type: "contains",
			value: createLiteralExpression("featured"),
			expression: {
				type: "reference",
				reference: {
					type: "relationship-join",
					joinKey: "ownership",
					path: ["properties", "tags"],
				},
			},
		});

		expect(clause.sql).toContain("relationship_join_ownership");
		expect(clause.sql).toContain("@>");
		expect(clause.sql).toContain("jsonb_build_array");
		expect(clause.params).toContain("featured");
	});
});
