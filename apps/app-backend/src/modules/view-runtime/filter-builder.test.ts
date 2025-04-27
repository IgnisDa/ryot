import { describe, expect, it } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import {
	createSmartphoneSchema,
	createTabletSchema,
} from "~/lib/test-fixtures";
import { buildSchemaMap } from "~/lib/views/reference";
import { buildFilterWhereClause } from "./filter-builder";

const dialect = new PgDialect();

const smartphoneSchema = createSmartphoneSchema();

const tabletSchema = createTabletSchema();

const schemaMap = buildSchemaMap([smartphoneSchema, tabletSchema]);

const serializeClause = (
	filters: Parameters<typeof buildFilterWhereClause>[0]["filters"],
) => {
	const clause = buildFilterWhereClause({
		filters,
		schemaMap,
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
			{ op: "eq", field: "smartphones.manufacturer", value: "Apple" },
		]);

		expect(clause.sql).toContain("entities.properties ->>");
		expect(clause.params).toContain("manufacturer");
		expect(clause.params).toContain("Apple");
	});

	it("casts integer filters before comparison", () => {
		const clause = serializeClause([
			{ op: "eq", field: "smartphones.releaseYear", value: 2023 },
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
					field: "smartphones.releaseYear",
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
				field: "smartphones.manufacturer",
			},
		]);

		expect(clause.sql.toLowerCase()).toContain(" in ");
		expect(clause.params).toContain("Apple");
		expect(clause.params).toContain("Samsung");
	});

	it("builds isNull clauses without a value", () => {
		const clause = serializeClause([
			{ op: "isNull", field: "smartphones.manufacturer" },
		]);

		expect(clause.sql.toLowerCase()).toContain(" is null");
	});

	it("uses top-level columns directly for shared filters", () => {
		const nameClause = serializeClause([
			{ op: "eq", field: "@name", value: "Alpha Phone" },
		]);
		const createdAtClause = serializeClause([
			{ op: "gte", field: "@createdAt", value: new Date("2024-01-01") },
		]);

		expect(nameClause.sql).toContain("entities.name");
		expect(createdAtClause.sql).toContain("entities.created_at");
	});

	it("groups filters with and within schema and or across schemas", () => {
		const clause = serializeClause([
			{ op: "neq", field: "@name", value: "Legacy" },
			{ op: "gte", field: "smartphones.releaseYear", value: 2020 },
			{ op: "eq", field: "tablets.maker", value: "Apple" },
		]);

		expect(clause.sql.toLowerCase()).toContain(" or ");
		expect(clause.sql.toLowerCase()).toContain(" and ");
		expect(clause.params).toEqual([
			"smartphones",
			"Legacy",
			"releaseYear",
			2020,
			"tablets",
			"Legacy",
			"maker",
			"Apple",
		]);
	});

	it("builds contains as ilike for string properties", () => {
		const clause = serializeClause([
			{ op: "contains", field: "smartphones.manufacturer", value: "Apple" },
		]);

		expect(clause.sql.toLowerCase()).toContain("ilike");
		expect(clause.params).toContain("%Apple%");
	});

	it("builds contains as jsonb array containment for array properties", () => {
		const clause = serializeClause([
			{ op: "contains", field: "smartphones.tags", value: "sci-fi" },
		]);

		expect(clause.sql).toContain("@>");
		expect(clause.params).toContain('["sci-fi"]');
	});

	it("builds contains as jsonb object containment for object properties", () => {
		const clause = serializeClause([
			{
				op: "contains",
				value: { source: "import" },
				field: "smartphones.metadata",
			},
		]);

		expect(clause.sql).toContain("@>");
		expect(clause.params).toContain('{"source":"import"}');
	});

	it("builds contains as ilike for top-level @name", () => {
		const clause = serializeClause([
			{ op: "contains", field: "@name", value: "Pro" },
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
				field: "smartphones.manufacturer",
			},
		]);

		expect(clause.sql.toLowerCase()).toContain("ilike");
		expect(clause.params).toContain("%50\\% off\\_sale%");
	});
});
