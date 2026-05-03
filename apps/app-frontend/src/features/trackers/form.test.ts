import { describe, expect, it } from "bun:test";

import {
	buildTrackerFormValues,
	createTrackerFormSchema,
	toCreateTrackerPayload,
	toUpdateTrackerPayload,
} from "./form";
import { createTrackerFormValuesFixture } from "./test-fixtures";

const v = createTrackerFormValuesFixture;

describe("toCreateTrackerPayload", () => {
	it("converts input with required fields", () => {
		const input = v({
			icon: "target",
			name: "Custom Tracker",
			slug: "custom-tracker",
		});

		const payload = toCreateTrackerPayload(input);

		expect(payload).toEqual({
			icon: "target",
			name: "Custom Tracker",
			slug: "custom-tracker",
			accentColor: "#5B7FFF",
		});
	});

	it("trims string inputs", () => {
		const input = v({
			icon: "  target  ",
			name: "  My Tracker  ",
			slug: "  my-tracker  ",
		});

		const payload = toCreateTrackerPayload(input);

		expect(payload.accentColor).toBe("#5B7FFF");
		expect(payload.icon).toBe("target");
		expect(payload.name).toBe("My Tracker");
		expect(payload.slug).toBe("my-tracker");
	});

	it("includes optional fields when provided", () => {
		const input = v({
			icon: "target",
			accentColor: "#ff0000",
			description: "A test tracker",
		});

		const payload = toCreateTrackerPayload(input);

		expect(payload.icon).toBe("target");
		expect(payload.description).toBe("A test tracker");
		expect(payload.accentColor).toBe("#ff0000");
	});

	it("keeps required fields when optional fields are not provided", () => {
		const input = v();

		const payload = toCreateTrackerPayload(input);

		expect(payload.accentColor).toBe("#5B7FFF");
		expect(payload.icon).toBe("shapes");
		expect(payload).not.toHaveProperty("description");
	});

	it("excludes only optional fields when optional values are whitespace-only", () => {
		const input = v({
			description: "\n\t",
		});

		const payload = toCreateTrackerPayload(input);

		expect(payload.accentColor).toBe("#5B7FFF");
		expect(payload.icon).toBe("shapes");
		expect(payload).not.toHaveProperty("description");
	});
});

describe("toUpdateTrackerPayload", () => {
	it("converts input with allowed fields", () => {
		const input = v({
			icon: "sparkles",
			accentColor: "#00ff00",
			description: "Updated description",
		});

		const payload = toUpdateTrackerPayload(input);

		expect(payload).toEqual({
			name: "Tracker",
			icon: "sparkles",
			accentColor: "#00ff00",
			description: "Updated description",
		});
	});

	it("trims string inputs", () => {
		const input = v({
			icon: "  sparkles  ",
			name: "  Tracker Name  ",
			accentColor: "  #00ff00  ",
			description: "  New description  ",
		});

		const payload = toUpdateTrackerPayload(input);

		expect(payload.name).toBe("Tracker Name");
		expect(payload.icon).toBe("sparkles");
		expect(payload.description).toBe("New description");
		expect(payload.accentColor).toBe("#00ff00");
	});

	it("keeps required fields when optional fields are blank", () => {
		const input = v();

		const payload = toUpdateTrackerPayload(input);

		expect(payload.accentColor).toBe("#5B7FFF");
		expect(payload.icon).toBe("shapes");
		expect(payload.description).toBeNull();
	});

	it("includes name but excludes slug in update payload", () => {
		const input = v({
			icon: "sparkles",
			accentColor: "#0000ff",
			name: "  Should Update  ",
			description: "Update this",
		});

		const payload = toUpdateTrackerPayload(input);

		expect(payload.name).toBe("Should Update");
		expect(payload.icon).toBe("sparkles");
		expect(payload.description).toBe("Update this");
		expect(payload.accentColor).toBe("#0000ff");
		expect(payload).not.toHaveProperty("slug");
	});

	it("handles optional whitespace-only fields", () => {
		const input = v({ description: "\t\n" });

		const payload = toUpdateTrackerPayload(input);

		expect(payload.accentColor).toBe("#5B7FFF");
		expect(payload.icon).toBe("shapes");
		expect(payload.description).toBeNull();
	});

	it("returns required fields with nullables for blank optional fields", () => {
		const input = v();

		const payload = toUpdateTrackerPayload(input);

		expect(payload).toEqual({
			icon: "shapes",
			name: "Tracker",
			description: null,
			accentColor: "#5B7FFF",
		});
	});
});

describe("createTrackerFormSchema", () => {
	it("rejects missing accent color", () => {
		const parsed = createTrackerFormSchema.safeParse({
			icon: "film",
			name: "Tracker",
			slug: "tracker",
			description: "",
			accentColor: "",
		});

		expect(parsed.success).toBe(false);
	});

	it("rejects missing icon", () => {
		const parsed = createTrackerFormSchema.safeParse({
			icon: "",
			name: "Tracker",
			slug: "tracker",
			description: "",
			accentColor: "#5B7FFF",
		});

		expect(parsed.success).toBe(false);
	});

	it("rejects whitespace-only required fields", () => {
		const parsed = createTrackerFormSchema.safeParse({
			icon: "",
			name: "   ",
			slug: "\n\t",
			description: "",
			accentColor: "#5B7FFF",
		});

		expect(parsed.success).toBe(false);
	});
});

describe("buildTrackerFormValues", () => {
	it("returns default values when no existing tracker values are provided", () => {
		const values = buildTrackerFormValues();

		expect(values).toEqual({
			name: "",
			slug: "",
			icon: "",
			description: "",
			accentColor: "",
		});
	});

	it("maps existing values into form defaults", () => {
		const values = buildTrackerFormValues({
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
