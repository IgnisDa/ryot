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
});
