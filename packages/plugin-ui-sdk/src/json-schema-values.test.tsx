import { describe, expect, it } from "bun:test";

import { render, screen } from "@testing-library/react";

import { JsonSchemaValues } from "./json-schema-values";

const schema = {
	type: "object",
	$defs: { Reading: { type: "object", properties: { metricId: { type: "string" } } } },
	properties: {
		pinned: { type: "boolean" },
		occurredAt: { type: "string", title: "Taken" },
		tags: { type: "array", items: { type: "string" } },
		comment: { anyOf: [{ type: "string" }, { type: "null" }] },
		values: { type: "array", items: { $ref: "#/$defs/Reading" } },
	},
};

describe("JsonSchemaValues", () => {
	it("labels fields from schema titles or keys in schema order and renders nested values", () => {
		const { container } = render(
			<JsonSchemaValues
				schema={schema}
				value={{
					extra: 1,
					pinned: false,
					comment: null,
					tags: ["a", "b"],
					occurredAt: "2026-11-13T08:10:00Z",
					values: [{ value: 78.4, metricId: "body-weight" }],
				}}
			/>,
		);
		expect(
			Array.from(container.querySelectorAll(":scope > div > dl > div > dt")).map(
				(term) => term.textContent,
			),
		).toEqual(["Pinned", "Taken", "Tags", "Comment", "Values", "Extra"]);
		expect(screen.getByText("Metric ID")).toBeTruthy();
		expect(screen.getByText("body-weight")).toBeTruthy();
		expect(screen.getByText("a, b")).toBeTruthy();
		expect(screen.getByText("No")).toBeTruthy();
		expect(screen.getByText("None")).toBeTruthy();
	});
});
