import { describe, expect, it } from "bun:test";

import type { AppSchema } from "@ryot/ts-utils";
import { createComputedFieldExpression, createEntityPropertyExpression } from "@ryot/ts-utils";
import { PgDialect } from "drizzle-orm/pg-core";

import {
	comparisonPredicate as comparison,
	createSmartphoneSchema,
	createTabletSchema,
	eventExpression,
	literalExpression,
} from "~/lib/test-fixtures";
import type { ViewComputedField, ViewPredicate } from "~/lib/views/expression";
import { buildEventJoinMap, buildRelationshipJoinMap, buildSchemaMap } from "~/lib/views/reference";

import { createQueryCompiler } from "./expression-compiler";
import { createExpressionTypeResolver } from "./expression-type-resolver";
import { buildFilterWhereClause } from "./filter-builder";

const dialect = new PgDialect();

const tabletSchema = createTabletSchema();
const smartphoneSchema = createSmartphoneSchema();
const schemaMap = buildSchemaMap([smartphoneSchema, tabletSchema]);
const reviewEventPropertiesSchema: AppSchema = {
	fields: {
		rating: {
			label: "Rating",
			type: "number",
			description: "Review rating",
		},
	},
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
const ownershipJoin = {
	key: "ownership",
	kind: "latestRelationship" as const,
	relationshipSchemaSlug: "ownership",
	propertiesSchema: {
		fields: {
			rating: {
				label: "Rating",
				type: "integer" as const,
				description: "Owner rating",
			},
			tags: {
				label: "Tags",
				type: "array" as const,
				description: "Ownership tags",
				items: { label: "Tag", type: "string" as const, description: "A tag" },
			},
		},
	},
};

const context = {
	schemaMap,
	eventJoinMap: buildEventJoinMap([reviewJoin]),
	relationshipJoinMap: buildRelationshipJoinMap([ownershipJoin]),
};

const serializeClause = (predicate: ViewPredicate, computedFields?: ViewComputedField[]) => {
	const getTypeInfo = createExpressionTypeResolver({ context, computedFields });
	const compiler = createQueryCompiler({ context, getTypeInfo, computedFields, alias: "entities" });
	const clause = buildFilterWhereClause({ context, compiler, predicate, computedFields });
	return dialect.sqlToQuery(clause);
};

describe("buildFilterWhereClause", () => {
	it("builds comparison predicates for schema properties", () => {
		const clause = serializeClause(
			comparison(
				createEntityPropertyExpression("smartphones", "manufacturer"),
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
				createEntityPropertyExpression("smartphones", "releaseYear"),
				"eq",
				literalExpression(2023),
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
						type: "arithmetic",
						operator: "divide",
						right: literalExpression(2),
						left: literalExpression(13.75),
					},
				},
				"eq",
				literalExpression(6),
			),
		);

		expect(clause.sql.toLowerCase()).toContain("trunc(");
		expect(clause.params).toContain(13.75);
		expect(clause.params).toContain(6);
	});

	it("supports computed-field references inside predicates", () => {
		const clause = serializeClause(
			comparison(createComputedFieldExpression("makerLabel"), "eq", literalExpression("Apple")),
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
					literalExpression(2020),
				),
				{
					type: "or",
					predicates: [
						comparison(
							createEntityPropertyExpression("smartphones", "manufacturer"),
							"eq",
							literalExpression("Apple"),
						),
						comparison(
							createEntityPropertyExpression("tablets", "maker"),
							"eq",
							literalExpression("Apple"),
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

	it("builds in predicates with expression values", () => {
		const clause = serializeClause({
			type: "in",
			expression: createEntityPropertyExpression("smartphones", "manufacturer"),
			values: [literalExpression("Apple"), literalExpression("Samsung")],
		});

		expect(clause.sql.toLowerCase()).toContain(" in ");
		expect(clause.params).toContain("Apple");
		expect(clause.params).toContain("Samsung");
	});

	it("builds contains predicates for string expressions", () => {
		const clause = serializeClause({
			type: "contains",
			expression: createEntityPropertyExpression("smartphones", "manufacturer"),
			value: literalExpression("Apple"),
		});

		expect(clause.sql.toLowerCase()).toContain("ilike");
		expect(clause.sql.toLowerCase()).toContain("escape '\\'");
	});

	it("builds contains predicates for array expressions", () => {
		const clause = serializeClause({
			type: "contains",
			expression: createEntityPropertyExpression("smartphones", "tags"),
			value: literalExpression("sci-fi"),
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
			comparison(eventExpression("review", "rating"), "gte", literalExpression(4)),
		);

		expect(clause.sql).toContain("event_join_review");
		expect(clause.params).toContain("properties");
		expect(clause.params).toContain("rating");
		expect(clause.params).toContain(4);
	});

	it("filters by relationship built-in (createdAt comparison)", () => {
		const clause = serializeClause(
			comparison(
				{
					type: "reference",
					reference: { path: ["createdAt"], joinKey: "ownership", type: "relationship-join" },
				},
				"gte",
				literalExpression("2024-01-01T00:00:00.000Z"),
			),
		);

		expect(clause.sql).toContain("relationship_join_ownership");
		expect(clause.params).toContain("createdAt");
		expect(clause.params).toContain("2024-01-01T00:00:00.000Z");
	});

	it("filters by relationship property (integer comparison)", () => {
		const clause = serializeClause(
			comparison(
				{
					type: "reference",
					reference: {
						joinKey: "ownership",
						type: "relationship-join",
						path: ["properties", "rating"],
					},
				},
				"gte",
				literalExpression(3),
			),
		);

		expect(clause.sql).toContain("relationship_join_ownership");
		expect(clause.params).toContain("rating");
		expect(clause.params).toContain(3);
	});

	it("filters by relationship array property (contains)", () => {
		const clause = serializeClause({
			type: "contains",
			value: literalExpression("featured"),
			expression: {
				type: "reference",
				reference: {
					joinKey: "ownership",
					type: "relationship-join",
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
