import { describe, expect, it } from "bun:test";
import { getFacetNavActionUi } from "./facet-nav-item-ui";

describe("getFacetNavActionUi", () => {
	it("returns edit action for custom facets", () => {
		expect(getFacetNavActionUi({ enabled: true, isBuiltin: false })).toEqual({
			kind: "edit",
			label: "Edit facet",
		});
	});

	it("returns disable action for enabled built-in facets", () => {
		expect(getFacetNavActionUi({ enabled: true, isBuiltin: true })).toEqual({
			kind: "toggle",
			label: "Disable facet",
		});
	});

	it("returns enable action for disabled built-in facets", () => {
		expect(getFacetNavActionUi({ enabled: false, isBuiltin: true })).toEqual({
			kind: "toggle",
			label: "Enable facet",
		});
	});
});
