import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { describe, expect, it } from "vitest";

import {
	describeOptionFields,
	initialOptionValues,
	toOptionsPayload,
	validateOptionValues,
} from "./options-form-state";

const described = (label: string) => ({ label, description: label });

const schema = {
	rules: [
		{
			path: ["note"],
			kind: "validation",
			validation: { required: true },
			message: "Note is required for the UK region",
			when: { operator: "eq", path: ["region"], value: "uk" },
		},
	],
	fields: {
		note: { ...described("Note"), type: "string" },
		year: { ...described("Year"), type: "integer", defaultValue: 2026 },
		payload: { ...described("Payload"), type: "object", properties: {} },
		adult: { ...described("Adult"), type: "boolean", defaultValue: false },
		title: { ...described("Title"), type: "string", validation: { required: true } },
		tags: { ...described("Tags"), type: "array", items: { ...described("Tag"), type: "string" } },
		region: {
			...described("Region"),
			type: "enum",
			defaultValue: "us",
			choices: { kind: "static", values: [{ value: "us" }, { value: "uk" }] },
		},
		genres: {
			...described("Genres"),
			type: "enum-array",
			choices: {
				kind: "static",
				values: [
					{ value: "epic", label: "Epic" },
					{ value: "scifi", label: "Science fiction" },
				],
			},
		},
	},
} satisfies AppSchema;

describe("provider-add options form state", () => {
	it("describes supported fields and reports unsupported property types", () => {
		const { fields, unsupported } = describeOptionFields(schema);

		expect(fields.map((field) => field.key).sort()).toEqual([
			"adult",
			"genres",
			"note",
			"region",
			"title",
			"year",
		]);
		expect([...unsupported].sort()).toEqual(["payload", "tags"]);
		expect(fields.find((field) => field.key === "title")?.required).toBe(true);
		expect(fields.find((field) => field.key === "genres")?.choices).toEqual([
			{ value: "epic", label: "Epic" },
			{ value: "scifi", label: "Science fiction" },
		]);
		expect(fields.find((field) => field.key === "note")?.choices).toBeUndefined();
	});

	it("reports unresolved dynamic choices as unsupported", () => {
		const describedSchema = {
			fields: {
				region: {
					...described("Region"),
					type: "enum",
					choices: { kind: "dynamic", source: "regions" },
				},
			},
		} satisfies AppSchema;

		expect(describeOptionFields(describedSchema)).toEqual({ fields: [], unsupported: ["region"] });
	});

	it("seeds values from declared defaults and leaves the rest undefined", () => {
		expect(initialOptionValues(schema)).toEqual({
			year: 2026,
			region: "us",
			adult: false,
			note: undefined,
			title: undefined,
			genres: undefined,
		});
	});

	it("fires conditional required rules only when the condition holds", () => {
		const base = { title: "Dune", note: undefined };

		expect(validateOptionValues(schema, { ...base, region: "us" }).get("note")).toBeUndefined();
		expect(validateOptionValues(schema, { ...base, region: "uk" }).get("note")).toBe(
			"Note is required for the UK region",
		);
		expect(
			validateOptionValues(schema, { ...base, note: "  ", region: "uk" }).get("note"),
		).toBeUndefined();
	});

	it("reports declared required fields and treats empty selections as missing", () => {
		const errors = validateOptionValues(schema, { title: "", genres: [], region: "us" });

		expect(errors.get("title")).toBe("Title is required");
		expect(errors.get("genres")).toBeUndefined();
	});

	it("evaluates existence, membership, and combined rule conditions", () => {
		const conditional = (when: AppSchema["rules"]) => ({ ...schema, rules: when });
		const values = { title: "Dune", region: "uk", year: 2026, note: undefined };
		const noteRule = {
			path: ["note"],
			kind: "validation",
			validation: { required: true },
		} as const;

		expect(
			validateOptionValues(
				conditional([{ ...noteRule, when: { operator: "exists", path: ["region"] } }]),
				values,
			).get("note"),
		).toBe("Note is required");
		expect(
			validateOptionValues(
				conditional([{ ...noteRule, when: { operator: "not_exists", path: ["region"] } }]),
				values,
			).get("note"),
		).toBeUndefined();
		expect(
			validateOptionValues(
				conditional([
					{ ...noteRule, when: { operator: "in", path: ["region"], value: ["uk", "us"] } },
				]),
				values,
			).get("note"),
		).toBe("Note is required");
		expect(
			validateOptionValues(
				conditional([
					{ ...noteRule, when: { operator: "not_in", path: ["region"], value: ["uk"] } },
				]),
				values,
			).get("note"),
		).toBeUndefined();
		expect(
			validateOptionValues(
				conditional([
					{
						...noteRule,
						when: {
							operator: "all",
							conditions: [
								{ operator: "eq", path: ["region"], value: "uk" },
								{ operator: "neq", path: ["year"], value: 1999 },
							],
						},
					},
				]),
				values,
			).get("note"),
		).toBe("Note is required");
		expect(
			validateOptionValues(
				conditional([
					{
						...noteRule,
						when: {
							operator: "any",
							conditions: [{ operator: "eq", path: ["region"], value: "de" }],
						},
					},
				]),
				values,
			).get("note"),
		).toBeUndefined();
	});

	it("omits undefined and empty-string values from the payload", () => {
		expect(
			toOptionsPayload(schema, {
				note: "",
				year: 2026,
				adult: false,
				title: "Dune",
				genres: ["epic"],
				region: undefined,
			}),
		).toEqual({ year: 2026, adult: false, title: "Dune", genres: ["epic"] });
		expect(toOptionsPayload(schema, { genres: [] })).toEqual({});
	});
});
