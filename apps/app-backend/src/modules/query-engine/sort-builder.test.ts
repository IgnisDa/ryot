import { describe, expect, it } from "vitest";

import {
	createEntityPropertyExpression,
	createEntitySchemaExpression,
	createLiteralExpression,
	type QueryComputedField,
	type QueryExpression,
} from "~/lib/query-language";

import type { QueryEngineContext } from "./context";
import { buildSortExpression } from "./sort-builder";
import {
	context,
	createComputedFieldExpression,
	createQueryTestCompiler,
	dialect,
	singleSchemaContext,
} from "./test-support";

const buildSort = (input: {
	alias: string;
	context: QueryEngineContext;
	expression: QueryExpression;
	computedFields?: ReadonlyArray<QueryComputedField>;
}) => {
	const compiler = createQueryTestCompiler(input);
	return buildSortExpression({
		compiler,
		context: input.context,
		expression: input.expression,
		computedFields: input.computedFields,
	});
};

describe("buildSortExpression", () => {
	it("compiles entity property sort expressions", () => {
		const query = dialect.sqlToQuery(
			buildSort({
				alias: "entities",
				context,
				expression: createEntityPropertyExpression("smartphones", "releaseYear"),
			}),
		);

		expect(query.sql).toContain("entities.properties ->>");
		expect(query.params).toContain("releaseYear");
		expect(query.sql).toContain("::integer");
	});

	it("compiles string property sort expressions without integer casts", () => {
		const query = dialect.sqlToQuery(
			buildSort({
				alias: "entities",
				context,
				expression: createEntityPropertyExpression("smartphones", "nameplate"),
			}),
		);

		expect(query.sql).toContain("entities.properties ->>");
		expect(query.params).toContain("nameplate");
		expect(query.sql).not.toContain("::integer");
	});

	it("compiles entity schema sort expressions", () => {
		const query = dialect.sqlToQuery(
			buildSort({
				alias: "entities",
				context,
				expression: createEntitySchemaExpression("name"),
			}),
		);

		expect(query.sql).toContain("entity_schema_data ->>");
		expect(query.params).toContain("name");
	});

	it("compiles sort expressions with computed fields", () => {
		const query = dialect.sqlToQuery(
			buildSort({
				alias: "entities",
				context,
				expression: createComputedFieldExpression("nextYear"),
				computedFields: [
					{
						key: "nextYear",
						expression: {
							left: createEntityPropertyExpression("smartphones", "releaseYear"),
							right: createLiteralExpression(1),
							type: "arithmetic",
							operator: "add",
						},
					},
				],
			}),
		);

		expect(query.sql.toLowerCase()).toContain("case when");
		expect(query.params).toContain("releaseYear");
	});

	it("rejects image expressions in sort", () => {
		expect(() =>
			buildSort({
				alias: "entities",
				context,
				expression: {
					type: "reference",
					reference: { type: "entity", slug: "smartphones", path: ["image"] },
				},
			}),
		).toThrow("display-only");
	});

	it("uses multi-schema CASE WHEN wrapping for entity properties", () => {
		const query = dialect.sqlToQuery(
			buildSort({
				alias: "entities",
				context,
				expression: createEntityPropertyExpression("smartphones", "nameplate"),
			}),
		);

		expect(query.sql.toLowerCase()).toContain("case when");
		expect(query.sql).toContain("entity_schema_data");
	});

	it("does not use CASE WHEN in single-schema contexts", () => {
		const query = dialect.sqlToQuery(
			buildSort({
				alias: "entities",
				context: singleSchemaContext,
				expression: createEntityPropertyExpression("smartphones", "nameplate"),
			}),
		);

		expect(query.sql.toLowerCase()).not.toContain("case when");
	});

	it("sorts by relationship built-ins and scalar properties", () => {
		const builtInQuery = dialect.sqlToQuery(
			buildSort({
				alias: "entities",
				context,
				expression: {
					type: "reference",
					reference: {
						type: "relationship-join",
						joinKey: "ownership",
						path: ["createdAt"],
					},
				},
			}),
		);
		const propertyQuery = dialect.sqlToQuery(
			buildSort({
				alias: "entities",
				context,
				expression: {
					type: "reference",
					reference: {
						type: "relationship-join",
						joinKey: "ownership",
						path: ["properties", "rating"],
					},
				},
			}),
		);

		expect(builtInQuery.sql).toContain("entities.relationship_join_ownership");
		expect(builtInQuery.params).toContain("createdAt");
		expect(propertyQuery.sql).toContain("entities.relationship_join_ownership");
		expect(propertyQuery.params).toContain("rating");
		expect(propertyQuery.sql).toContain("::integer");
	});

	it("throws when sorting by sourceEntity.image", () => {
		expect(() =>
			buildSort({
				alias: "entities",
				context,
				expression: {
					type: "reference",
					reference: {
						type: "relationship-join",
						joinKey: "ownership",
						path: ["sourceEntity", "image"],
					},
				},
			}),
		).toThrow("display-only");
	});
});
