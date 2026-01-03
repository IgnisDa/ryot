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
								slug: "smartphones",
								property: "metadata",
								type: "schema-property",
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
									slug: "smartphones",
									property: "announcedAt",
									type: "schema-property",
								},
							},
						},
					],
				}),
			);

			expect(query.sql).toContain("at time zone 'UTC'");
			expect(query.sql).toContain('YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
		});

		it("does not use plain to_jsonb for dates (which would use server timezone)", () => {
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
									slug: "smartphones",
									property: "announcedAt",
									type: "schema-property",
								},
							},
						},
					],
				}),
			);

			const hasToJsonbWithoutUtc =
				query.sql.includes("to_jsonb(") &&
				!query.sql.includes("at time zone 'UTC'");
			expect(hasToJsonbWithoutUtc).toBe(false);
		});
	});
});
