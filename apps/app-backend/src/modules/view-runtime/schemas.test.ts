import { describe, expect, it } from "bun:test";
import { executeViewRuntimeBody } from "./schemas";

describe("executeViewRuntimeBody", () => {
	it("rejects non-JSON literal expression values", () => {
		const result = executeViewRuntimeBody.safeParse({
			filters: [],
			eventJoins: [],
			computedFields: [],
			entitySchemaSlugs: ["book"],
			pagination: { page: 1, limit: 10 },
			sort: { fields: ["entity.book.@name"], direction: "asc" },
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
		const result = executeViewRuntimeBody.safeParse({
			filters: [],
			eventJoins: [],
			entitySchemaSlugs: ["book"],
			pagination: { page: 1, limit: 10 },
			sort: { fields: ["entity.book.@name"], direction: "asc" },
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
