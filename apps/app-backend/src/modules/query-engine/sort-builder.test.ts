import { describe, expect, it } from "bun:test";
import {
	createEntityPropertyExpression,
	createEntitySchemaExpression,
} from "@ryot/ts-utils";
import { PgDialect } from "drizzle-orm/pg-core";
import {
	createSmartphoneSchema,
	createTabletSchema,
	literalExpression,
} from "~/lib/test-fixtures";
import { buildEventJoinMap, buildSchemaMap } from "~/lib/views/reference";
import type { QueryEngineContext } from "./schemas";
import { buildSortExpression } from "./sort-builder";

const dialect = new PgDialect();
const tabletSchema = createTabletSchema();
const smartphoneSchema = createSmartphoneSchema();
const schemaMap = buildSchemaMap([smartphoneSchema, tabletSchema]);
const context: QueryEngineContext = {
	schemaMap,
	eventJoinMap: buildEventJoinMap([]),
};

describe("buildSortExpression", () => {
	it("compiles an entity property sort expression", () => {
		const sortExpr = buildSortExpression({
			context,
			alias: "entities",
			computedFields: [],
			expression: createEntityPropertyExpression("smartphones", "releaseYear"),
		});

		const query = dialect.sqlToQuery(sortExpr);
		expect(query.sql).toContain("entities.properties ->>");
		expect(query.params).toContain("releaseYear");
		expect(query.sql).toContain("::integer");
	});

	it("compiles a string property sort expression", () => {
		const sortExpr = buildSortExpression({
			context,
			alias: "entities",
			computedFields: [],
			expression: createEntityPropertyExpression("smartphones", "nameplate"),
		});

		const query = dialect.sqlToQuery(sortExpr);
		expect(query.sql).toContain("entities.properties ->>");
		expect(query.params).toContain("nameplate");
		expect(query.sql).not.toContain("::integer");
	});

	it("compiles an entity schema sort expression", () => {
		const sortExpr = buildSortExpression({
			context,
			alias: "entities",
			computedFields: [],
			expression: createEntitySchemaExpression("name"),
		});

		const query = dialect.sqlToQuery(sortExpr);
		expect(query.sql).toContain("entity_schema_data ->>");
		expect(query.params).toContain("name");
	});

	it("compiles a sort expression with a computed field", () => {
		const sortExpr = buildSortExpression({
			context,
			alias: "entities",
			expression: {
				type: "reference",
				reference: { type: "computed-field", key: "nextYear" },
			},
			computedFields: [
				{
					key: "nextYear",
					expression: {
						operator: "add",
						type: "arithmetic",
						right: literalExpression(1),
						left: createEntityPropertyExpression("smartphones", "releaseYear"),
					},
				},
			],
		});

		const query = dialect.sqlToQuery(sortExpr);
		expect(query.sql.toLowerCase()).toContain("case when");
		expect(query.params).toContain("releaseYear");
	});

	it("rejects image expressions in sort", () => {
		expect(() =>
			buildSortExpression({
				context,
				alias: "entities",
				computedFields: [],
				expression: {
					type: "reference",
					reference: { type: "entity", path: ["image"], slug: "smartphones" },
				},
			}),
		).toThrow("display-only");
	});

	it("uses multi-schema CASE WHEN wrapping for entity property with multiple schemas", () => {
		const sortExpr = buildSortExpression({
			context,
			alias: "entities",
			computedFields: [],
			expression: createEntityPropertyExpression("smartphones", "nameplate"),
		});

		const query = dialect.sqlToQuery(sortExpr);
		expect(query.sql.toLowerCase()).toContain("case when");
		expect(query.sql).toContain("entity_schema_data");
	});

	it("does not use CASE WHEN for single-schema context", () => {
		const singleSchemaContext: QueryEngineContext = {
			eventJoinMap: buildEventJoinMap([]),
			schemaMap: buildSchemaMap([smartphoneSchema]),
		};
		const sortExpr = buildSortExpression({
			alias: "entities",
			computedFields: [],
			context: singleSchemaContext,
			expression: createEntityPropertyExpression("smartphones", "nameplate"),
		});

		const query = dialect.sqlToQuery(sortExpr);
		expect(query.sql.toLowerCase()).not.toContain("case when");
	});
});
