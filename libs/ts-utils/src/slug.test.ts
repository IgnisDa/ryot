import { describe, expect, it } from "bun:test";
import {
	normalizeSlug,
	resolveRequiredSlug,
	resolveRequiredString,
} from "./index";

describe("normalizeSlug", () => {
	it("normalizes mixed separators and casing", () => {
		expect(normalizeSlug("  Hello_World Test  ")).toBe("hello-world-test");
	});

	it("returns an empty string when nothing slug-safe remains", () => {
		expect(normalizeSlug("___")).toBe("");
	});
});

describe("resolveRequiredSlug", () => {
	it("prefers the provided slug over the name", () => {
		expect(
			resolveRequiredSlug({
				label: "Facet",
				name: "Ignored Name",
				slug: " Custom_Slug ",
			}),
		).toBe("custom-slug");
	});

	it("falls back to the name when slug is undefined", () => {
		expect(
			resolveRequiredSlug({
				label: "Facet",
				name: "Derived Name",
			}),
		).toBe("derived-name");
	});

	it("throws when the resolved slug is empty", () => {
		expect(() =>
			resolveRequiredSlug({
				name: "___",
				label: "Facet",
			}),
		).toThrow("Facet slug is required");
	});

	it("throws when a blank slug is provided", () => {
		expect(() =>
			resolveRequiredSlug({
				label: "Facet",
				slug: "  \n\t ",
				name: "Derived Name",
			}),
		).toThrow("Facet slug is required");
	});
});

describe("resolveRequiredString", () => {
	it("trims surrounding whitespace", () => {
		expect(resolveRequiredString("  value  ", "Entity id")).toBe("value");
	});

	it("throws when the trimmed value is empty", () => {
		expect(() => resolveRequiredString("   ", "Entity id")).toThrow(
			"Entity id is required",
		);
	});
});
