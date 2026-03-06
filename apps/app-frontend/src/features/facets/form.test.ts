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
		const input = v({ name: "Custom Facet", slug: "custom-facet" });

		const payload = toCreateFacetPayload(input);

		expect(payload).toEqual({
			name: "Custom Facet",
			slug: "custom-facet",
		});
	});

	it("trims string inputs", () => {
		const input = v({ name: "  My Facet  ", slug: "  my-facet  " });

		const payload = toCreateFacetPayload(input);

		expect(payload.name).toBe("My Facet");
		expect(payload.slug).toBe("my-facet");
	});

	it("includes optional fields when provided", () => {
		const input = v({
			icon: "lucide:target",
			accentColor: "#ff0000",
			description: "A test facet",
		});

		const payload = toCreateFacetPayload(input);

		expect(payload.icon).toBe("lucide:target");
		expect(payload.description).toBe("A test facet");
		expect(payload.accentColor).toBe("#ff0000");
	});

	it("excludes optional fields when not provided", () => {
		const input = v();

		const payload = toCreateFacetPayload(input);

		expect(payload).not.toHaveProperty("icon");
		expect(payload).not.toHaveProperty("description");
		expect(payload).not.toHaveProperty("accentColor");
	});

	it("excludes optional fields when values are whitespace-only", () => {
		const input = v({
			icon: "   ",
			description: "\n\t",
			accentColor: "   ",
		});

		const payload = toCreateFacetPayload(input);

		expect(payload).not.toHaveProperty("icon");
		expect(payload).not.toHaveProperty("description");
		expect(payload).not.toHaveProperty("accentColor");
	});
});

describe("toUpdateFacetPayload", () => {
	it("converts input with allowed fields", () => {
		const input = v({
			icon: "lucide:sparkles",
			accentColor: "#00ff00",
			description: "Updated description",
		});

		const payload = toUpdateFacetPayload(input);

		expect(payload).toEqual({
			icon: "lucide:sparkles",
			name: "Facet",
			slug: "facet",
			accentColor: "#00ff00",
			description: "Updated description",
		});
	});

	it("trims string inputs", () => {
		const input = v({
			icon: "  lucide:sparkles  ",
			name: "  Facet Name  ",
			slug: "  facet-name  ",
			accentColor: "  #00ff00  ",
			description: "  New description  ",
		});

		const payload = toUpdateFacetPayload(input);

		expect(payload.name).toBe("Facet Name");
		expect(payload.slug).toBe("facet-name");
		expect(payload.icon).toBe("lucide:sparkles");
		expect(payload.description).toBe("New description");
		expect(payload.accentColor).toBe("#00ff00");
	});

	it("converts empty string to null for nullable fields", () => {
		const input = v();

		const payload = toUpdateFacetPayload(input);

		expect(payload.icon).toBeNull();
		expect(payload.description).toBeNull();
		expect(payload.accentColor).toBeNull();
	});

	it("includes name and slug in update payload", () => {
		const input = v({
			icon: "lucide:sparkles",
			accentColor: "#0000ff",
			name: "  Should Update  ",
			slug: "  should-update  ",
			description: "Update this",
		});

		const payload = toUpdateFacetPayload(input);

		expect(payload.name).toBe("Should Update");
		expect(payload.slug).toBe("should-update");
		expect(payload.icon).toBe("lucide:sparkles");
		expect(payload.description).toBe("Update this");
		expect(payload.accentColor).toBe("#0000ff");
	});

	it("handles partial input with whitespace-only fields", () => {
		const input = v({ icon: "   ", description: "\t\n" });

		const payload = toUpdateFacetPayload(input);

		expect(payload.icon).toBeNull();
		expect(payload.description).toBeNull();
	});

	it("returns nullables when optional fields are blank", () => {
		const input = v();

		const payload = toUpdateFacetPayload(input);

		expect(payload).toEqual({
			icon: null,
			name: "Facet",
			slug: "facet",
			accentColor: null,
			description: null,
		});
	});
});

describe("createFacetFormSchema", () => {
	it("rejects whitespace-only required fields", () => {
		const parsed = createFacetFormSchema.safeParse({
			icon: "",
			name: "   ",
			slug: "\n\t",
			description: "",
			accentColor: "",
		});

		expect(parsed.success).toBe(false);
	});

	it("accepts valid values", () => {
		const parsed = createFacetFormSchema.safeParse({
			icon: "lucide:target",
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
			icon: "lucide:film",
			name: "Media",
			slug: "media",
			description: "Track media",
			accentColor: "#111111",
		});

		expect(values).toEqual({
			icon: "lucide:film",
			slug: "media",
			name: "Media",
			description: "Track media",
			accentColor: "#111111",
		});
	});
});
