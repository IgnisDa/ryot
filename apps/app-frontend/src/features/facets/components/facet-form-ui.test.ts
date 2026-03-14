import { describe, expect, it } from "bun:test";
import { getFacetToggleUi } from "./facet-form-ui";

describe("getFacetToggleUi", () => {
	it("hides toggle when no active facet", () => {
		expect(getFacetToggleUi(undefined)).toEqual({
			color: "teal",
			visible: false,
			variant: "default",
			label: "Enable facet",
		});
	});

	it("returns disable CTA for enabled facet", () => {
		expect(getFacetToggleUi({ enabled: true })).toEqual({
			color: "red",
			visible: true,
			variant: "light",
			label: "Disable facet",
		});
	});

	it("returns enable CTA for disabled facet", () => {
		expect(getFacetToggleUi({ enabled: false })).toEqual({
			color: "teal",
			visible: true,
			variant: "default",
			label: "Enable facet",
		});
	});
});
