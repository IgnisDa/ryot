import { describe, expect, it } from "bun:test";
import { getFacetNavActionUi } from "./facet-nav-item-ui";

describe("getFacetNavActionUi", () => {
	it("returns disable action for enabled facets", () => {
		expect(getFacetNavActionUi({ enabled: true, isBuiltin: false })).toEqual({
			kind: "toggle",
			label: "Disable facet",
		});
	});

	it("returns enable action for disabled facets", () => {
		expect(getFacetNavActionUi({ enabled: false, isBuiltin: false })).toEqual({
			kind: "toggle",
			label: "Enable facet",
		});
	});
});
