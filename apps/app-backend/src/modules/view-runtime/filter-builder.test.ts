import { describe, expect, it } from "bun:test";
import type { AppSchema } from "@ryot/ts-utils";
import { PgDialect } from "drizzle-orm/pg-core";
import {
	createSmartphoneSchema,
	createTabletSchema,
} from "~/lib/test-fixtures";
import type { ViewComputedField, ViewExpression } from "~/lib/views/expression";
import type { ViewPredicate } from "~/lib/views/filtering";
import { buildEventJoinMap, buildSchemaMap } from "~/lib/views/reference";
import { buildFilterWhereClause } from "./filter-builder";

const dialect = new PgDialect();

const smartphoneSchema = createSmartphoneSchema();
const tabletSchema = createTabletSchema();
const schemaMap = buildSchemaMap([smartphoneSchema, tabletSchema]);
const reviewEventPropertiesSchema: AppSchema = {
	fields: { rating: { type: "number" } },
};
const reviewJoin = {
	key: "review",
	eventSchemaSlug: "review",
	kind: "latestEvent" as const,
	eventSchemas: [
		{
			slug: "review",
			id: "event-schema-1",
			entitySchemaId: "schema-1",
			entitySchemaSlug: "smartphones",
			propertiesSchema: reviewEventPropertiesSchema,
		},
		{
			slug: "review",
			id: "event-schema-2",
			entitySchemaId: "schema-2",
			entitySchemaSlug: "tablets",
			propertiesSchema: reviewEventPropertiesSchema,
		},
	],
	eventSchemaMap: new Map([
		[
			"smartphones",
			{
				slug: "review",
				id: "event-schema-1",
				entitySchemaId: "schema-1",
				entitySchemaSlug: "smartphones",
				propertiesSchema: reviewEventPropertiesSchema,
			},
		],
		[
			"tablets",
			{
				slug: "review",
				id: "event-schema-2",
				entitySchemaId: "schema-2",
				entitySchemaSlug: "tablets",
				propertiesSchema: reviewEventPropertiesSchema,
			},
		],
	]),
};
const context = { schemaMap, eventJoinMap: buildEventJoinMap([reviewJoin]) };

const entityExpression = (
	schemaSlug: string,
	field: string,
): ViewExpression => ({
	type: "reference",
	reference: field.startsWith("@")
		? { type: "entity-column", slug: schemaSlug, column: field.slice(1) }
		: { type: "schema-property", slug: schemaSlug, property: field },
});

const eventExpression = (joinKey: string, field: string): ViewExpression => ({
	type: "reference",
	reference: field.startsWith("@")
		? { type: "event-join-column", joinKey, column: field.slice(1) }
		: { type: "event-join-property", joinKey, property: field },
});

const computedExpression = (key: string): ViewExpression => ({
	type: "reference",
	reference: { key, type: "computed-field" },
});

const literalExpression = (value: unknown): ViewExpression => ({
	value,
	type: "literal",
});

const comparison = (
	left: ViewExpression,
	operator: Extract<ViewPredicate, { type: "comparison" }>["operator"],
	right: ViewExpression,
): ViewPredicate => ({ type: "comparison", left, right, operator });

const serializeClause = (
	predicate: ViewPredicate,
	computedFields?: ViewComputedField[],
) => {
	const clause = buildFilterWhereClause({
		context,
		predicate,
		computedFields,
		alias: "entities",
	});

	if (!clause) {
		throw new Error("Expected a filter clause");
	}

	return dialect.sqlToQuery(clause);
};

describe("buildFilterWhereClause", () => {
	it("builds comparison predicates for schema properties", () => {
		const clause = serializeClause(
			comparison(
				entityExpression("smartphones", "manufacturer"),
				"eq",
				literalExpression("Apple"),
			),
		);

		expect(clause.sql).toContain("entities.properties ->>");
		expect(clause.params).toContain("manufacturer");
		expect(clause.params).toContain("Apple");
	});

	it("casts integer comparisons before evaluation", () => {
		const clause = serializeClause(
			comparison(
				entityExpression("smartphones", "releaseYear"),
				"eq",
				literalExpression(2023),
			),
		);

		expect(clause.sql).toContain("::integer");
		expect(clause.params).toContain(2023);
	});

	it("supports computed-field references inside predicates", () => {
		const clause = serializeClause(
			comparison(
				computedExpression("makerLabel"),
				"eq",
				literalExpression("Apple"),
			),
			[
				{
					key: "makerLabel",
					expression: entityExpression("smartphones", "manufacturer"),
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
					entityExpression("smartphones", "releaseYear"),
					"gte",
					literalExpression(2020),
				),
				{
					type: "or",
					predicates: [
						comparison(
							entityExpression("smartphones", "manufacturer"),
							"eq",
							literalExpression("Apple"),
						),
						comparison(
							entityExpression("tablets", "maker"),
							"eq",
							literalExpression("Apple"),
						),
					],
				},
			],
		});

		expect(clause.sql.toLowerCase()).toContain(" and ");
		expect(clause.sql.toLowerCase()).toContain(" or ");
		expect(clause.sql).toContain("entity_schema_slug");
	});

	it("builds null-check predicates", () => {
		const nullClause = serializeClause({
			type: "isNull",
			expression: entityExpression("smartphones", "manufacturer"),
		});
		const notNullClause = serializeClause({
			type: "isNotNull",
			expression: entityExpression("smartphones", "manufacturer"),
		});

		expect(nullClause.sql.toLowerCase()).toContain(" is null");
		expect(notNullClause.sql.toLowerCase()).toContain(" is not null");
	});

	it("builds in predicates with expression values", () => {
		const clause = serializeClause({
			type: "in",
			expression: entityExpression("smartphones", "manufacturer"),
			values: [literalExpression("Apple"), literalExpression("Samsung")],
		});

		expect(clause.sql.toLowerCase()).toContain(" in ");
		expect(clause.params).toContain("Apple");
		expect(clause.params).toContain("Samsung");
	});

	it("builds contains predicates for string expressions", () => {
		const clause = serializeClause({
			type: "contains",
			expression: entityExpression("smartphones", "manufacturer"),
			value: literalExpression("Apple"),
		});

		expect(clause.sql.toLowerCase()).toContain("ilike");
		expect(clause.sql.toLowerCase()).toContain("escape '\\'");
	});

	it("builds contains predicates for array expressions", () => {
		const clause = serializeClause({
			type: "contains",
			expression: entityExpression("smartphones", "tags"),
			value: literalExpression("sci-fi"),
		});

		expect(clause.sql).toContain("@>");
		expect(clause.sql).toContain("jsonb_build_array");
	});

	it("builds joined latest-event predicates", () => {
		const clause = serializeClause(
			comparison(
				eventExpression("review", "rating"),
				"gte",
				literalExpression(4),
			),
		);

		expect(clause.sql).toContain("event_join_review");
		expect(clause.sql).toContain("-> 'properties'");
		expect(clause.params).toContain("rating");
		expect(clause.params).toContain(4);
	});
});
