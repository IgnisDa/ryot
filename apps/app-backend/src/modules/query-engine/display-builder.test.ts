import { describe, expect, it } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { createSmartphoneSchema } from "~/lib/test-fixtures";
import { buildEventJoinMap, buildSchemaMap } from "~/lib/views/reference";
import { buildResolvedFieldsExpression } from "./display-builder";

const dialect = new PgDialect();
const context = {
	schemaMap: buildSchemaMap([createSmartphoneSchema()]),
	eventJoinMap: buildEventJoinMap([]),
};

describe("buildResolvedFieldsExpression", () => {
	it("treats jsonb null object values as null display values", () => {
		const query = dialect.sqlToQuery(
			buildResolvedFieldsExpression({
				context,
				alias: "entities",
				computedFields: [],
				fields: [
					{
						key: "metadata",
						expression: {
							type: "reference",
							reference: {
								type: "entity",
								slug: "smartphones",
								path: ["properties", "metadata"],
							},
						},
					},
				],
			}),
		);

		expect(query.sql.toLowerCase()).toContain("nullif");
		expect(query.sql).toContain("'null'::jsonb");
	});

	describe("date field UTC formatting", () => {
		it("formats date properties in UTC timezone", () => {
			const query = dialect.sqlToQuery(
				buildResolvedFieldsExpression({
					context,
					alias: "entities",
					computedFields: [],
					fields: [
						{
							key: "announcedAt",
							expression: {
								type: "reference",
								reference: {
									type: "entity",
									slug: "smartphones",
									path: ["properties", "announcedAt"],
								},
							},
						},
					],
				}),
			);

			expect(query.sql).toContain("at time zone 'UTC'");
			expect(query.sql).toContain('YYYY-MM-DD"T"HH24:MI:SS.MS3"Z"');
		});

		it("wraps date in to_char with UTC timezone, not plain to_jsonb", () => {
			const query = dialect.sqlToQuery(
				buildResolvedFieldsExpression({
					context,
					alias: "entities",
					computedFields: [],
					fields: [
						{
							key: "announcedAt",
							expression: {
								type: "reference",
								reference: {
									type: "entity",
									slug: "smartphones",
									path: ["properties", "announcedAt"],
								},
							},
						},
					],
				}),
			);

			expect(query.sql).toContain("to_jsonb(to_char(");
			expect(query.sql).toContain("at time zone 'UTC'");
		});

		it("applies UTC formatting to entity builtin date fields (createdAt/updatedAt)", () => {
			const query = dialect.sqlToQuery(
				buildResolvedFieldsExpression({
					context,
					alias: "entities",
					computedFields: [],
					fields: [
						{
							key: "createdAt",
							expression: {
								type: "reference",
								reference: {
									type: "entity",
									slug: "smartphones",
									path: ["createdAt"],
								},
							},
						},
					],
				}),
			);

			expect(query.sql).toContain("at time zone 'UTC'");
			expect(query.sql).toContain('YYYY-MM-DD"T"HH24:MI:SS.MS3"Z"');
		});

		it("applies UTC formatting to datetime properties (normalized to date)", () => {
			const query = dialect.sqlToQuery(
				buildResolvedFieldsExpression({
					context,
					alias: "entities",
					computedFields: [],
					fields: [
						{
							key: "releasedAt",
							expression: {
								type: "reference",
								reference: {
									type: "entity",
									slug: "smartphones",
									path: ["properties", "releasedAt"],
								},
							},
						},
					],
				}),
			);

			expect(query.sql).toContain("at time zone 'UTC'");
			expect(query.sql).toContain('YYYY-MM-DD"T"HH24:MI:SS.MS3"Z"');
		});
	});

	describe("non-date scalar field formatting", () => {
		it.each([
			["releaseYear", "integer"],
			["screenSize", "number"],
			["nameplate", "string"],
			["isFoldable", "boolean"],
		] as const)("%s (%s) uses plain to_jsonb without UTC wrapping", (property) => {
			const query = dialect.sqlToQuery(
				buildResolvedFieldsExpression({
					context,
					alias: "entities",
					computedFields: [],
					fields: [
						{
							key: property,
							expression: {
								type: "reference",
								reference: {
									type: "entity",
									slug: "smartphones",
									path: ["properties", property],
								},
							},
						},
					],
				}),
			);

			expect(query.sql).not.toContain("at time zone 'UTC'");
			expect(query.sql).not.toContain("to_char(");
		});
	});

	describe("transform expression display values", () => {
		it("titleCase transform resolves to text kind", () => {
			const query = dialect.sqlToQuery(
				buildResolvedFieldsExpression({
					context,
					alias: "entities",
					computedFields: [],
					fields: [
						{
							key: "formattedName",
							expression: {
								type: "transform",
								name: "titleCase",
								expression: {
									type: "reference",
									reference: {
										type: "entity",
										slug: "smartphones",
										path: ["properties", "nameplate"],
									},
								},
							},
						},
					],
				}),
			);

			expect(query.sql).toContain("initcap(");
			expect(query.sql).toContain("'text'");
		});

		it("kebabCase transform resolves to text kind", () => {
			const query = dialect.sqlToQuery(
				buildResolvedFieldsExpression({
					context,
					alias: "entities",
					computedFields: [],
					fields: [
						{
							key: "slugified",
							expression: {
								type: "transform",
								name: "kebabCase",
								expression: {
									type: "reference",
									reference: {
										type: "entity",
										slug: "smartphones",
										path: ["properties", "nameplate"],
									},
								},
							},
						},
					],
				}),
			);

			expect(query.sql).toContain("lower(");
			expect(query.sql).toContain("'text'");
		});
	});
});
