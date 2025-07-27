import { describe, expect, it } from "bun:test";
import { getGeneratedPropertyFieldConfig } from "./generated-property-fields";

describe("getGeneratedPropertyFieldConfig", () => {
	it("maps primitive generated properties to the shared field config", () => {
		expect(
			getGeneratedPropertyFieldConfig("notes", {
				type: "string",
				label: "Notes",
				validation: { required: true },
			}),
		).toEqual({
			kind: "text",
			label: "Notes",
			required: true,
			placeholder: "Enter Notes",
		});

		expect(
			getGeneratedPropertyFieldConfig("completed", {
				type: "boolean",
				label: "Completed",
			}),
		).toEqual({
			required: false,
			kind: "checkbox",
			label: "Completed",
		});

		expect(
			getGeneratedPropertyFieldConfig("startedOn", {
				type: "date",
				label: "Started On",
				validation: { required: true },
			}),
		).toEqual({
			kind: "text",
			required: true,
			inputType: "date",
			label: "Started On",
		});

		expect(
			getGeneratedPropertyFieldConfig("completedAt", {
				type: "datetime",
				label: "Completed At",
				validation: { required: true },
			}),
		).toEqual({
			kind: "text",
			required: true,
			label: "Completed At",
			placeholder: "2026-03-27T14:30:00Z",
		});

		expect(
			getGeneratedPropertyFieldConfig("pages", {
				label: "Pages",
				type: "integer",
				validation: { required: true },
			}),
		).toEqual({
			kind: "number",
			label: "Pages",
			required: true,
			placeholder: "Enter Pages",
		});
	});

	it("returns null for unsupported property types", () => {
		expect(
			getGeneratedPropertyFieldConfig("tags", {
				label: "Tags",
				type: "array",
				items: { label: "Item", type: "string" },
			}),
		).toBeNull();
	});

	it("can fall back unsupported property types to text fields", () => {
		expect(
			getGeneratedPropertyFieldConfig(
				"metadata",
				{
					label: "Metadata",
					type: "object",
					validation: { required: true },
					properties: {
						rating: {
							type: "number",
							label: "Rating",
							validation: { required: true },
						},
					},
				},
				{ fallback: "text" },
			),
		).toEqual({
			kind: "text",
			required: true,
			label: "Metadata",
			placeholder: "Enter Metadata",
		});
	});
});
