import { describe, expect, it } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { createSmartphoneSchema } from "~/lib/test-fixtures";
import { buildEventJoinMap, buildSchemaMap } from "~/lib/views/reference";
import { createScalarExpressionCompiler } from "./expression-compiler";

const dialect = new PgDialect();
const context = {
	eventJoinMap: buildEventJoinMap([]),
	schemaMap: buildSchemaMap([createSmartphoneSchema()]),
};

const computedExpression = (key: string) => ({
	type: "reference" as const,
	reference: { key, type: "computed-field" as const },
});

const yearExpression = {
	type: "reference" as const,
	reference: {
		slug: "smartphones",
		property: "releaseYear",
		type: "schema-property" as const,
	},
};

describe("createScalarExpressionCompiler", () => {
	it("compiles nested computed fields for scalar query stages", () => {
		const compiler = createScalarExpressionCompiler({
			alias: "entities",
			context,
			computedFields: [
				{
					key: "nextYear",
					expression: {
						operator: "add",
						type: "arithmetic",
						left: yearExpression,
						right: { type: "literal", value: 1 },
					},
				},
				{
					key: "label",
					expression: {
						type: "concat",
						values: [
							{ type: "literal", value: "Release " },
							computedExpression("nextYear"),
						],
					},
				},
			],
		});

		const query = dialect.sqlToQuery(
			compiler.compile(computedExpression("label")),
		);

		expect(query.sql.toLowerCase()).toContain("concat(");
		expect(query.sql).toContain("entities.properties ->>");
	});

	it("reuses cached computed field expressions for the same target type", () => {
		const compiler = createScalarExpressionCompiler({
			alias: "entities",
			context,
			computedFields: [
				{
					key: "nextYear",
					expression: {
						operator: "add",
						type: "arithmetic",
						left: yearExpression,
						right: { type: "literal", value: 1 },
					},
				},
			],
		});

		const first = compiler.compile(computedExpression("nextYear"), "integer");
		const second = compiler.compile(computedExpression("nextYear"), "integer");
		const third = compiler.compile(computedExpression("nextYear"), "number");

		expect(first).toBe(second);
		expect(first).not.toBe(third);
	});

	it("rejects image computed fields in scalar sort and filter contexts", () => {
		const compiler = createScalarExpressionCompiler({
			context,
			alias: "entities",
			computedFields: [
				{
					key: "cover",
					expression: {
						type: "reference",
						reference: {
							column: "image",
							slug: "smartphones",
							type: "entity-column",
						},
					},
				},
			],
		});

		expect(() =>
			compiler.compile(computedExpression("cover"), "string"),
		).toThrow(
			"Image expressions are display-only and cannot be compiled for sort or filter usage",
		);
	});
});
