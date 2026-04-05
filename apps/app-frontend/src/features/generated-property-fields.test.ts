import { describe, expect, it } from "bun:test";
import { getGeneratedPropertyFieldConfig } from "./generated-property-fields";

describe("getGeneratedPropertyFieldConfig", () => {
	it("maps primitive generated properties to the shared field config", () => {
		expect(
			getGeneratedPropertyFieldConfig("notes", {
				type: "string",
				validation: { required: true },
			}),
		).toEqual({
			kind: "text",
			label: "notes",
			required: true,
			placeholder: "Enter notes",
		});

		expect(
			getGeneratedPropertyFieldConfig("completed", {
				type: "boolean",
			}),
		).toEqual({
			required: false,
			kind: "checkbox",
			label: "completed",
		});

		expect(
			getGeneratedPropertyFieldConfig("startedOn", {
				type: "date",
				validation: { required: true },
			}),
		).toEqual({
			kind: "text",
			required: true,
			inputType: "date",
			label: "startedOn",
		});

		expect(
			getGeneratedPropertyFieldConfig("completedAt", {
				type: "datetime",
				validation: { required: true },
			}),
		).toEqual({
			kind: "text",
			required: true,
			label: "completedAt",
			placeholder: "2026-03-27T14:30:00Z",
		});

		expect(
			getGeneratedPropertyFieldConfig("pages", {
				type: "integer",
				validation: { required: true },
			}),
		).toEqual({
			kind: "number",
			label: "pages",
			required: true,
			placeholder: "Enter pages",
		});
	});

	it("returns null for unsupported property types", () => {
		expect(
			getGeneratedPropertyFieldConfig("tags", {
				type: "array",
				items: { type: "string" },
			}),
		).toBeNull();
	});

	it("can fall back unsupported property types to text fields", () => {
		expect(
			getGeneratedPropertyFieldConfig(
				"metadata",
				{
					type: "object",
					validation: { required: true },
					properties: {
						rating: { type: "number", validation: { required: true } },
					},
				},
				{ fallback: "text" },
			),
		).toEqual({
			kind: "text",
			required: true,
			label: "metadata",
			placeholder: "Enter metadata",
		});
	});
});
