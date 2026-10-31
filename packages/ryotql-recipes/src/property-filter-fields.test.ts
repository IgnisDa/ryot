import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { propertyFilterFields } from "./property-filter-fields";

const base = { description: "d" };

const schema: AppSchema = {
	fields: {
		born: { ...base, type: "date", label: "Born" },
		name: { ...base, label: "Name", type: "string" },
		done: { ...base, label: "Done", type: "boolean" },
		ratio: { ...base, label: "Ratio", type: "number" },
		seen: { ...base, label: "Seen", type: "datetime" },
		count: { ...base, label: "Count", type: "integer" },
		nested: { ...base, type: "object", properties: {}, label: "Nested" },
		dynamic: { ...base, type: "enum", label: "Dynamic", choices: { source: "s", kind: "dynamic" } },
		tags: {
			...base,
			label: "Tags",
			type: "array",
			items: { ...base, label: "Tag", type: "string" },
		},
		muscles: {
			...base,
			label: "Muscles",
			type: "enum-array",
			choices: { kind: "static", values: [{ value: "chest", label: "Chest" }] },
		},
		level: {
			...base,
			type: "enum",
			label: "Level",
			choices: { kind: "static", values: [{ value: "easy", label: "Easy" }, { value: "hard" }] },
		},
	},
};

describe("propertyFilterFields", () => {
	it("maps property types to filter field types with labelled choices", () => {
		const fields = Result.getOrThrow(
			propertyFilterFields(schema, [
				{ property: "level", field: "levelField" },
				{ property: "muscles", field: "musclesField" },
				{ property: "name", field: "nameField" },
				{ property: "count", field: "countField" },
				{ property: "ratio", field: "ratioField" },
				{ property: "born", field: "bornField" },
				{ property: "seen", field: "seenField" },
				{ property: "done", field: "doneField" },
				{ property: "tags", field: "tagsField" },
			]),
		);
		expect(fields.map(({ key, type }) => [key, type])).toEqual([
			["level", "enum"],
			["muscles", "enum-list"],
			["name", "text"],
			["count", "number"],
			["ratio", "number"],
			["born", "date"],
			["seen", "date"],
			["done", "boolean"],
			["tags", "text-list"],
		]);
		expect(fields[0]).toEqual({
			key: "level",
			type: "enum",
			kind: "value",
			label: "Level",
			field: "levelField",
			choices: [
				{ value: "easy", label: "Easy" },
				{ value: "hard", label: "hard" },
			],
		});
	});

	it("fails for unknown, dynamic-choice and unsupported properties", () => {
		for (const property of ["missing", "dynamic", "nested"]) {
			expect(Result.isFailure(propertyFilterFields(schema, [{ property, field: "f" }]))).toBe(true);
		}
	});
});
