import { describe, expect, it } from "bun:test";
import {
	buildFacetFormValues,
	createFacetFormSchema,
	toCreateFacetPayload,
	toUpdateFacetPayload,
} from "./form";
import { createFacetFormValuesFixture } from "./test-fixtures";

const v = createFacetFormValuesFixture;

describe("toCreateFacetPayload", () => {
	it("converts input with required fields", () => {
		const input = v({
			icon: "target",
			name: "Custom Facet",
			slug: "custom-facet",
		});

		const payload = toCreateFacetPayload(input);

		expect(payload).toEqual({
			icon: "target",
			name: "Custom Facet",
			slug: "custom-facet",
			accentColor: "#5B7FFF",
		});
	});

	it("trims string inputs", () => {
		const input = v({
			icon: "  target  ",
			name: "  My Facet  ",
			slug: "  my-facet  ",
		});

		const payload = toCreateFacetPayload(input);

		expect(payload.accentColor).toBe("#5B7FFF");
		expect(payload.icon).toBe("target");
		expect(payload.name).toBe("My Facet");
		expect(payload.slug).toBe("my-facet");
	});

	it("includes optional fields when provided", () => {
		const input = v({
			icon: "target",
			accentColor: "#ff0000",
			description: "A test facet",
		});

		const payload = toCreateFacetPayload(input);

		expect(payload.icon).toBe("target");
		expect(payload.description).toBe("A test facet");
		expect(payload.accentColor).toBe("#ff0000");
	});

	it("keeps required fields when optional fields are not provided", () => {
		const input = v();

		const payload = toCreateFacetPayload(input);

		expect(payload.accentColor).toBe("#5B7FFF");
		expect(payload.icon).toBe("shapes");
		expect(payload).not.toHaveProperty("description");
	});

	it("excludes only optional fields when optional values are whitespace-only", () => {
		const input = v({
			description: "\n\t",
		});

		const payload = toCreateFacetPayload(input);

		expect(payload.accentColor).toBe("#5B7FFF");
		expect(payload.icon).toBe("shapes");
		expect(payload).not.toHaveProperty("description");
	});
});

describe("toUpdateFacetPayload", () => {
	it("converts input with allowed fields", () => {
		const input = v({
			icon: "sparkles",
			accentColor: "#00ff00",
			description: "Updated description",
		});

		const payload = toUpdateFacetPayload(input);

		expect(payload).toEqual({
			name: "Facet",
			slug: "facet",
			icon: "sparkles",
			accentColor: "#00ff00",
			description: "Updated description",
		});
	});

	it("trims string inputs", () => {
		const input = v({
			icon: "  sparkles  ",
			name: "  Facet Name  ",
			slug: "  facet-name  ",
			accentColor: "  #00ff00  ",
			description: "  New description  ",
		});

		const payload = toUpdateFacetPayload(input);

		expect(payload.name).toBe("Facet Name");
		expect(payload.slug).toBe("facet-name");
		expect(payload.icon).toBe("sparkles");
		expect(payload.description).toBe("New description");
		expect(payload.accentColor).toBe("#00ff00");
	});

	it("keeps required fields when optional fields are blank", () => {
		const input = v();

		const payload = toUpdateFacetPayload(input);

		expect(payload.accentColor).toBe("#5B7FFF");
		expect(payload.icon).toBe("shapes");
		expect(payload.description).toBeNull();
	});

	it("includes name and slug in update payload", () => {
		const input = v({
			icon: "sparkles",
			accentColor: "#0000ff",
			name: "  Should Update  ",
			slug: "  should-update  ",
			description: "Update this",
		});

		const payload = toUpdateFacetPayload(input);

		expect(payload.name).toBe("Should Update");
		expect(payload.slug).toBe("should-update");
		expect(payload.icon).toBe("sparkles");
		expect(payload.description).toBe("Update this");
		expect(payload.accentColor).toBe("#0000ff");
	});

	it("handles optional whitespace-only fields", () => {
		const input = v({ description: "\t\n" });

		const payload = toUpdateFacetPayload(input);

		expect(payload.accentColor).toBe("#5B7FFF");
		expect(payload.icon).toBe("shapes");
		expect(payload.description).toBeNull();
	});

	it("returns required fields with nullables for blank optional fields", () => {
		const input = v();

		const payload = toUpdateFacetPayload(input);

		expect(payload).toEqual({
			icon: "shapes",
			name: "Facet",
			slug: "facet",
			description: null,
			accentColor: "#5B7FFF",
		});
	});
});

describe("createFacetFormSchema", () => {
	it("rejects missing accent color", () => {
		const parsed = createFacetFormSchema.safeParse({
			icon: "film",
			name: "Facet",
			slug: "facet",
			description: "",
			accentColor: "",
		});

		expect(parsed.success).toBe(false);
	});

	it("rejects missing icon", () => {
		const parsed = createFacetFormSchema.safeParse({
			icon: "",
			name: "Facet",
			slug: "facet",
			description: "",
			accentColor: "#5B7FFF",
		});

		expect(parsed.success).toBe(false);
	});

	it("rejects whitespace-only required fields", () => {
		const parsed = createFacetFormSchema.safeParse({
			icon: "",
			name: "   ",
			slug: "\n\t",
			description: "",
			accentColor: "#5B7FFF",
		});

		expect(parsed.success).toBe(false);
	});

	it("accepts valid values", () => {
		const parsed = createFacetFormSchema.safeParse({
			icon: "target",
			name: "My Facet",
			slug: "my-facet",
			description: "A facet",
			accentColor: "#00ff00",
		});

		expect(parsed.success).toBe(true);
	});
});

describe("buildFacetFormValues", () => {
	it("returns default values when no existing facet values are provided", () => {
		const values = buildFacetFormValues();

		expect(values).toEqual({
			name: "",
			slug: "",
			icon: "",
			description: "",
			accentColor: "",
		});
	});

	it("maps existing values into form defaults", () => {
		const values = buildFacetFormValues({
			icon: "film",
			name: "Media",
			slug: "media",
			description: "Track media",
			accentColor: "#111111",
		});

		expect(values).toEqual({
			icon: "film",
			slug: "media",
			name: "Media",
			description: "Track media",
			accentColor: "#111111",
		});
	});
});
