import { describe, expect, it } from "bun:test";
import type { AppSchema } from "@ryot/ts-utils";
import { PgDialect } from "drizzle-orm/pg-core";
import {
	createSmartphoneSchema,
	createTabletSchema,
} from "~/lib/test-fixtures";
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

const entityField = (schemaSlug: string, field: string) => {
	return `entity.${schemaSlug}.${field}`;
};

const serializeClause = (
	filters: Parameters<typeof buildFilterWhereClause>[0]["filters"],
) => {
	const clause = buildFilterWhereClause({
		filters,
		context,
		alias: "entities",
		entitySchemaSlugs: ["smartphones", "tablets"],
	});

	if (!clause) {
		throw new Error("Expected a filter clause");
	}

	return dialect.sqlToQuery(clause);
};

describe("buildFilterWhereClause", () => {
	it("builds an eq clause for string properties", () => {
		const clause = serializeClause([
			{ op: "eq", field: "entity.smartphones.manufacturer", value: "Apple" },
		]);

		expect(clause.sql).toContain("entities.properties ->>");
		expect(clause.params).toContain("manufacturer");
		expect(clause.params).toContain("Apple");
	});

	it("casts integer filters before comparison", () => {
		const clause = serializeClause([
			{ op: "eq", field: "entity.smartphones.releaseYear", value: 2023 },
		]);

		expect(clause.sql).toContain("::integer");
		expect(clause.params).toContain(2023);
	});

	it("builds comparison operators for primitive filters", () => {
		const expectations = [
			{ op: "lt" as const, operator: "<", value: 2020 },
			{ op: "gt" as const, operator: ">", value: 2020 },
			{ op: "lte" as const, operator: "<=", value: 2020 },
			{ op: "gte" as const, operator: ">=", value: 2020 },
			{ op: "neq" as const, operator: "<>", value: "Apple" },
		];

		for (const expectation of expectations) {
			const clause = serializeClause([
				{
					op: expectation.op,
					value: expectation.value,
					field: "entity.smartphones.releaseYear",
				},
			]);

			expect(clause.sql).toContain(expectation.operator);
		}
	});

	it("builds in clauses with array values", () => {
		const clause = serializeClause([
			{
				op: "in",
				value: ["Apple", "Samsung"],
				field: "entity.smartphones.manufacturer",
			},
		]);

		expect(clause.sql.toLowerCase()).toContain(" in ");
		expect(clause.params).toContain("Apple");
		expect(clause.params).toContain("Samsung");
	});

	it("builds isNull clauses without a value", () => {
		const clause = serializeClause([
			{ op: "isNull", field: "entity.smartphones.manufacturer" },
		]);

		expect(clause.sql.toLowerCase()).toContain(" is null");
	});

	it("uses entity columns directly for built-in filters", () => {
		const nameClause = serializeClause([
			{
				op: "eq",
				value: "Alpha Phone",
				field: entityField("smartphones", "@name"),
			},
		]);
		const createdAtClause = serializeClause([
			{
				op: "gte",
				value: new Date("2024-01-01"),
				field: entityField("smartphones", "@createdAt"),
			},
		]);

		expect(nameClause.sql).toContain("entities.name");
		expect(createdAtClause.sql).toContain("entities.created_at");
	});

	it("groups filters with and within schema and or across schemas", () => {
		const clause = serializeClause([
			{
				op: "neq",
				value: "Legacy",
				field: entityField("smartphones", "@name"),
			},
			{ op: "gte", field: "entity.smartphones.releaseYear", value: 2020 },
			{ op: "eq", field: "entity.tablets.maker", value: "Apple" },
		]);

		expect(clause.sql.toLowerCase()).toContain(" or ");
		expect(clause.sql.toLowerCase()).toContain(" and ");
		expect(clause.params).toEqual([
			"smartphones",
			"Legacy",
			"releaseYear",
			2020,
			"tablets",
			"maker",
			"Apple",
		]);
	});

	it("builds contains as ilike for string properties", () => {
		const clause = serializeClause([
			{
				op: "contains",
				value: "Apple",
				field: "entity.smartphones.manufacturer",
			},
		]);

		expect(clause.sql.toLowerCase()).toContain("ilike");
		expect(clause.params).toContain("%Apple%");
	});

	it("builds contains as jsonb array containment for array properties", () => {
		const clause = serializeClause([
			{ op: "contains", field: "entity.smartphones.tags", value: "sci-fi" },
		]);

		expect(clause.sql).toContain("@>");
		expect(clause.params).toContain('["sci-fi"]');
	});

	it("builds contains as jsonb object containment for object properties", () => {
		const clause = serializeClause([
			{
				op: "contains",
				value: { source: "import" },
				field: "entity.smartphones.metadata",
			},
		]);

		expect(clause.sql).toContain("@>");
		expect(clause.params).toContain('{"source":"import"}');
	});

	it("builds contains as ilike for entity @name", () => {
		const clause = serializeClause([
			{
				value: "Pro",
				op: "contains",
				field: entityField("smartphones", "@name"),
			},
		]);

		expect(clause.sql).toContain("entities.name");
		expect(clause.sql.toLowerCase()).toContain("ilike");
		expect(clause.params).toContain("%Pro%");
	});

	it("escapes ilike metacharacters in the contains value", () => {
		const clause = serializeClause([
			{
				op: "contains",
				value: "50% off_sale",
				field: "entity.smartphones.manufacturer",
			},
		]);

		expect(clause.sql.toLowerCase()).toContain("ilike");
		expect(clause.params).toContain("%50\\% off\\_sale%");
	});

	it("builds joined latest-event property filters against the prepared join column", () => {
		const clause = serializeClause([
			{ op: "gte", field: "event.review.rating", value: 4 },
		]);

		expect(clause.sql).toContain("event_join_review");
		expect(clause.sql).toContain("-> 'properties'");
		expect(clause.params).toContain("rating");
		expect(clause.params).toContain(4);
	});

	it("builds joined latest-event timestamp filters against event columns", () => {
		const clause = serializeClause([
			{
				op: "gte",
				field: "event.review.@createdAt",
				value: new Date("2024-01-01T00:00:00.000Z"),
			},
		]);

		expect(clause.sql).toContain("event_join_review");
		expect(clause.sql).toContain("->>");
		expect(clause.sql).toContain("::timestamp");
	});
});
