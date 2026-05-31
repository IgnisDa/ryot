import { describe, expect, it } from "vitest";

import { createEntityPropertyExpression, createTransformExpression } from "~/lib/query-language";

import { buildResolvedFieldsExpression } from "./display-sql-builder";
import { dialect, singleSchemaContext } from "./test-support";

describe("buildResolvedFieldsExpression", () => {
	it("treats jsonb null object values as null display values", () => {
		const query = dialect.sqlToQuery(
			buildResolvedFieldsExpression({
				alias: "entities",
				context: singleSchemaContext,
				computedFields: [],
				fields: [
					{
						key: "metadata",
						expression: createEntityPropertyExpression("smartphones", "metadata"),
					},
				],
			}),
		);

		expect(query.sql.toLowerCase()).toContain("nullif");
		expect(query.sql).toContain("'null'::jsonb");
	});

	it("formats date properties in UTC timezone", () => {
		const query = dialect.sqlToQuery(
			buildResolvedFieldsExpression({
				alias: "entities",
				context: singleSchemaContext,
				computedFields: [],
				fields: [
					{
						key: "announcedAt",
						expression: createEntityPropertyExpression("smartphones", "announcedAt"),
					},
				],
			}),
		);

		expect(query.sql).toContain("at time zone 'UTC'");
		expect(query.sql).toContain('YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"');
	});

	it("wraps dates in to_char with UTC normalization", () => {
		const query = dialect.sqlToQuery(
			buildResolvedFieldsExpression({
				alias: "entities",
				context: singleSchemaContext,
				computedFields: [],
				fields: [
					{
						key: "announcedAt",
						expression: createEntityPropertyExpression("smartphones", "announcedAt"),
					},
				],
			}),
		);

		expect(query.sql).toContain("to_jsonb(to_char(");
		expect(query.sql).toContain("at time zone 'UTC'");
	});

	it("applies UTC formatting to entity builtin date fields", () => {
		const query = dialect.sqlToQuery(
			buildResolvedFieldsExpression({
				alias: "entities",
				context: singleSchemaContext,
				computedFields: [],
				fields: [
					{
						key: "createdAt",
						expression: {
							type: "reference",
							reference: { type: "entity", slug: "smartphones", path: ["createdAt"] },
						},
					},
				],
			}),
		);

		expect(query.sql).toContain("at time zone 'UTC'");
		expect(query.sql).toContain('YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"');
	});

	it("applies UTC formatting to datetime properties", () => {
		const query = dialect.sqlToQuery(
			buildResolvedFieldsExpression({
				alias: "entities",
				context: singleSchemaContext,
				computedFields: [],
				fields: [
					{
						key: "releasedAt",
						expression: createEntityPropertyExpression("smartphones", "releasedAt"),
					},
				],
			}),
		);

		expect(query.sql).toContain("at time zone 'UTC'");
		expect(query.sql).toContain('YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"');
	});

	it.each(["releaseYear", "screenSize", "nameplate", "isFoldable"] as const)(
		"uses plain to_jsonb for non-date scalar fields: %s",
		(property) => {
			const query = dialect.sqlToQuery(
				buildResolvedFieldsExpression({
					alias: "entities",
					context: singleSchemaContext,
					computedFields: [],
					fields: [
						{
							key: property,
							expression: createEntityPropertyExpression("smartphones", property),
						},
					],
				}),
			);

			expect(query.sql).not.toContain("at time zone 'UTC'");
			expect(query.sql).not.toContain("to_char(");
		},
	);

	it("resolves titleCase transform display values to text", () => {
		const query = dialect.sqlToQuery(
			buildResolvedFieldsExpression({
				alias: "entities",
				context: singleSchemaContext,
				computedFields: [],
				fields: [
					{
						key: "formattedName",
						expression: createTransformExpression(
							"titleCase",
							createEntityPropertyExpression("smartphones", "nameplate"),
						),
					},
				],
			}),
		);

		expect(query.sql).toContain("initcap(");
		expect(query.sql).toContain("'text'");
	});

	it("resolves kebabCase transform display values to text", () => {
		const query = dialect.sqlToQuery(
			buildResolvedFieldsExpression({
				alias: "entities",
				context: singleSchemaContext,
				computedFields: [],
				fields: [
					{
						key: "slugified",
						expression: createTransformExpression(
							"kebabCase",
							createEntityPropertyExpression("smartphones", "nameplate"),
						),
					},
				],
			}),
		);

		expect(query.sql).toContain("lower(");
		expect(query.sql).toContain("'text'");
	});
});
