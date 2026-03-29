import { describe, expect, it } from "bun:test";
import { executeQueryEngineBody } from "./schemas";

describe("executeQueryEngineBody", () => {
	it("rejects non-JSON literal expression values", () => {
		const result = executeQueryEngineBody.safeParse({
			filter: null,
			eventJoins: [],
			computedFields: [],
			entitySchemaSlugs: ["book"],
			pagination: { page: 1, limit: 10 },
			sort: {
				direction: "asc",
				expression: {
					type: "reference",
					reference: { type: "entity-column", slug: "book", column: "name" },
				},
			},
			fields: [
				{
					key: "bad",
					expression: { type: "literal", value: new Date() },
				},
			],
		});

		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toBe(
			"Literal values must be JSON-safe",
		);
	});

	it("rejects duplicate computed field keys", () => {
		const result = executeQueryEngineBody.safeParse({
			filter: null,
			eventJoins: [],
			entitySchemaSlugs: ["book"],
			pagination: { page: 1, limit: 10 },
			sort: {
				direction: "asc",
				expression: {
					type: "reference",
					reference: { type: "entity-column", slug: "book", column: "name" },
				},
			},
			fields: [],
			computedFields: [
				{ key: "label", expression: { type: "literal", value: "A" } },
				{ key: "label", expression: { type: "literal", value: "B" } },
			],
		});

		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toBe(
			"Computed field keys must be unique",
		);
	});
});
