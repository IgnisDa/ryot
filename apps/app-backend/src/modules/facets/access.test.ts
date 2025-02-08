import { describe, expect, it } from "bun:test";
import { resolveCustomFacetAccess } from "./access";

describe("resolveCustomFacetAccess", () => {
	it("returns not found when the facet is missing", () => {
		const result = resolveCustomFacetAccess(undefined);

		expect(result).toEqual({ error: "not_found" });
	});

	it("rejects built-in facets", () => {
		const result = resolveCustomFacetAccess({
			id: "facet_1",
			isBuiltin: true,
			userId: "user_1",
		});

		expect(result).toEqual({ error: "builtin" });
	});

	it("returns the facet when it is custom", () => {
		const facet = { id: "facet_1", userId: "user_1", isBuiltin: false };

		const result = resolveCustomFacetAccess(facet);

		expect(result).toEqual({ facet });
	});
});
