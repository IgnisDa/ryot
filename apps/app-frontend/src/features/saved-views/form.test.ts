import { describe, expect, it } from "bun:test";
import { buildSavedViewFormValues, savedViewFormSchema } from "./form";

describe("buildSavedViewFormValues", () => {
	it("returns empty defaults when called with no arguments", () => {
		const values = buildSavedViewFormValues();

		expect(values.name).toBe("");
		expect(values.icon).toBe("");
		expect(values.accentColor).toBe("");
		expect(values.trackerId).toBe("");
	});

	it("maps provided view fields to form values", () => {
		const values = buildSavedViewFormValues({
			icon: "star",
			name: "Favorites",
			accentColor: "#2DD4BF",
			trackerId: "tracker-1",
		});

		expect(values.name).toBe("Favorites");
		expect(values.icon).toBe("star");
		expect(values.accentColor).toBe("#2DD4BF");
		expect(values.trackerId).toBe("tracker-1");
	});

	it("converts null trackerId to empty string", () => {
		const values = buildSavedViewFormValues({ trackerId: null });

		expect(values.trackerId).toBe("");
	});

	it("uses empty string defaults for missing fields", () => {
		const values = buildSavedViewFormValues({ name: "My View" });

		expect(values.name).toBe("My View");
		expect(values.icon).toBe("");
		expect(values.accentColor).toBe("");
		expect(values.trackerId).toBe("");
	});
});

describe("savedViewFormSchema", () => {
	it("accepts valid form values", () => {
		const result = savedViewFormSchema.safeParse({
			icon: "star",
			name: "Favorites",
			accentColor: "#2DD4BF",
			trackerId: "tracker-1",
		});

		expect(result.success).toBe(true);
	});

	it("accepts empty string trackerId for standalone views", () => {
		const result = savedViewFormSchema.safeParse({
			icon: "star",
			trackerId: "",
			name: "Favorites",
			accentColor: "#2DD4BF",
		});

		expect(result.success).toBe(true);
	});

	it("rejects empty name", () => {
		const result = savedViewFormSchema.safeParse({
			name: "",
			icon: "star",
			trackerId: "",
			accentColor: "#2DD4BF",
		});

		expect(result.success).toBe(false);
	});

	it("rejects empty icon", () => {
		const result = savedViewFormSchema.safeParse({
			icon: "",
			trackerId: "",
			name: "Favorites",
			accentColor: "#2DD4BF",
		});

		expect(result.success).toBe(false);
	});

	it("rejects empty accentColor", () => {
		const result = savedViewFormSchema.safeParse({
			icon: "star",
			trackerId: "",
			accentColor: "",
			name: "Favorites",
		});

		expect(result.success).toBe(false);
	});

	it("trims whitespace-only name as invalid", () => {
		const result = savedViewFormSchema.safeParse({
			name: "   ",
			icon: "star",
			trackerId: "",
			accentColor: "#2DD4BF",
		});

		expect(result.success).toBe(false);
	});
});
