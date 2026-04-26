import { describe, expect, it } from "bun:test";
import { createElement, isValidElement } from "react";
import { GeneratedPropertyField } from "../features/generated-property-fields";
import { normalizeNumberInputValue } from "./forms";

describe("normalizeNumberInputValue", () => {
	it("coerces valid numeric strings so form validation can recover", () => {
		expect(normalizeNumberInputValue(7)).toBe(7);
		expect(normalizeNumberInputValue("7")).toBe(7);
		expect(normalizeNumberInputValue("7.5")).toBe(7.5);
		expect(normalizeNumberInputValue("")).toBe("");
		expect(normalizeNumberInputValue("1.")).toBe("1.");
	});
});

describe("GeneratedPropertyField", () => {
	it("passes required to checkbox fields so Mantine can render its asterisk", () => {
		const element = GeneratedPropertyField({
			disabled: false,
			propertyKey: "completed",
			form: { AppField: (() => null) as never },
			propertyDef: {
				type: "boolean",
				label: "Completed",
				description: "Completed",
				validation: { required: true },
			},
		});

		expect(isValidElement(element)).toBe(true);

		const renderField = (
			element as { props: { children: (field: object) => unknown } }
		).props.children;

		const rendered = renderField({
			TextField: (props: object) => createElement("input", props),
			NumberField: (props: object) => createElement("input", props),
			CheckboxField: (props: object) => createElement("input", props),
		});

		expect(isValidElement(rendered)).toBe(true);
		expect((rendered as { props: { required?: boolean } }).props.required).toBe(
			true,
		);
	});
});
