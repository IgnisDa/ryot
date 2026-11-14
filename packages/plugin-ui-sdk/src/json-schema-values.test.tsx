import { describe, expect, it } from "bun:test";

import { fireEvent, render, screen } from "@testing-library/react";

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
		).toEqual(["Pinned", "Taken", "Tags", "Comment", "Values · 1 item", "Extra"]);
		expect(screen.getByText("Metric ID")).toBeTruthy();
		expect(screen.getByText("body-weight")).toBeTruthy();
		expect(screen.getByText("a, b")).toBeTruthy();
		expect(screen.getByText("No")).toBeTruthy();
		expect(screen.getByText("None")).toBeTruthy();
	});

	it("nests groups under their label and starts deep groups collapsed until expanded", () => {
		render(
			<JsonSchemaValues
				schema={{ type: "object" }}
				value={{ workout: { exercises: [{ name: "Squat", sets: [{ reps: 5 }, { reps: 3 }] }] } }}
			/>,
		);
		const workout = screen.getByRole("button", { name: "Workout · 1 field" });
		const exercises = screen.getByRole("button", { name: "Exercises · 1 item" });
		const item = screen.getByRole("button", { name: "Item 1 · 2 fields" });
		expect([workout, exercises].map((group) => group.getAttribute("aria-expanded"))).toEqual([
			"true",
			"true",
		]);
		expect(item.getAttribute("aria-expanded")).toBe("false");
		expect(screen.queryByText("Squat")).toBeNull();

		fireEvent.click(item);
		expect(screen.getByText("Squat")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Sets · 2 items" }).getAttribute("aria-expanded"),
		).toBe("false");

		fireEvent.click(workout);
		expect(screen.queryByRole("button", { name: "Exercises · 1 item" })).toBeNull();
	});
});
