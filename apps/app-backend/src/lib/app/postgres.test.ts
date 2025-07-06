import { describe, expect, it } from "bun:test";

import { isUniqueConstraintError } from "./postgres";

describe("isUniqueConstraintError", () => {
	it("returns true only for matching postgres unique constraint errors", () => {
		expect(
			isUniqueConstraintError(
				{ code: "23505", constraint: "entity_schema_user_slug_unique" },
				"entity_schema_user_slug_unique",
			),
		).toBeTrue();
		expect(
			isUniqueConstraintError(
				{
					code: "23505",
					constraint: "event_schema_user_entity_schema_slug_unique",
				},
				"entity_schema_user_slug_unique",
			),
		).toBeFalse();
		expect(
			isUniqueConstraintError(
				{ code: "22001", constraint: "entity_schema_user_slug_unique" },
				"entity_schema_user_slug_unique",
			),
		).toBeFalse();
		expect(isUniqueConstraintError(null, "entity_schema_user_slug_unique")).toBeFalse();
	});
});
