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

const visibilitySchema = {
	rules: [
		{
			path: ["secret"],
			kind: "visibility",
			visibility: { hidden: true },
			when: { operator: "neq", path: ["advanced"], value: true },
		},
	],
	fields: {
		advanced: { ...described("Advanced"), type: "boolean", defaultValue: false },
		secret: { ...described("Secret"), type: "string", validation: { required: true } },
	},
} satisfies AppSchema;

const cascadingVisibilitySchema = {
	rules: [
		{
			path: ["detail"],
			kind: "visibility",
			visibility: { hidden: true },
			when: { operator: "neq", path: ["advanced"], value: true },
		},
		{
			kind: "visibility",
			path: ["dependent"],
			visibility: { hidden: true },
			when: { operator: "neq", path: ["detail"], value: "enabled" },
		},
		{
			path: ["note"],
			kind: "validation",
			validation: { required: true },
			when: { operator: "eq", path: ["detail"], value: "enabled" },
		},
	],
	fields: {
		note: { ...described("Note"), type: "string" },
		detail: { ...described("Detail"), type: "string" },
		dependent: { ...described("Dependent"), type: "string" },
		advanced: { ...described("Advanced"), type: "boolean", defaultValue: false },
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

	it("orders fields by position and preserves declaration order for ties", () => {
		const positionedSchema = {
			fields: {
				last: { ...described("Last"), type: "string" },
				second: { ...described("Second"), type: "string", position: 2 },
				first: { ...described("First"), type: "string", position: 1 },
				secondTie: { ...described("Second tie"), type: "string", position: 2 },
				alsoLast: { ...described("Also last"), type: "string" },
			},
		} satisfies AppSchema;

		expect(describeOptionFields(positionedSchema).fields.map((field) => field.key)).toEqual([
			"first",
			"second",
			"secondTie",
			"last",
			"alsoLast",
		]);
	});

	it("toggles visibility and suppresses requiredness for hidden fields", () => {
		expect(describeOptionFields(visibilitySchema, { advanced: false }).fields).toMatchObject([
			{ key: "advanced", required: false },
		]);
		expect(describeOptionFields(visibilitySchema, { advanced: true }).fields).toMatchObject([
			{ key: "advanced", required: false },
			{ key: "secret", required: true },
		]);
		expect(validateOptionValues(visibilitySchema, { advanced: false, secret: "" }).size).toBe(0);
		expect(
			validateOptionValues(visibilitySchema, { advanced: true, secret: "" }).get("secret"),
		).toBe("Secret is required");
	});

	it("removes stale hidden values until cascading visibility stabilizes", () => {
		const values = { note: undefined, advanced: false, detail: "enabled", dependent: "retained" };

		expect(describeOptionFields(cascadingVisibilitySchema, values).fields).toMatchObject([
			{ key: "note", required: false },
			{ key: "advanced" },
		]);
		expect(validateOptionValues(cascadingVisibilitySchema, values).size).toBe(0);
		expect(toOptionsPayload(cascadingVisibilitySchema, values)).toEqual({ advanced: false });
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

	it("uses blank defaults for exists conditions and conditional requiredness", () => {
		const defaultedSchema = {
			rules: [
				{
					path: ["note"],
					kind: "validation",
					validation: { required: true },
					message: "Defaults make note required",
					when: {
						operator: "all",
						conditions: [
							{ operator: "exists", path: ["text"] },
							{ operator: "exists", path: ["selections"] },
						],
					},
				},
			],
			fields: {
				note: { ...described("Note"), type: "string" },
				text: { ...described("Text"), type: "string", defaultValue: "" },
				selections: {
					...described("Selections"),
					type: "enum-array",
					defaultValue: [],
					choices: { kind: "static", values: [] },
				},
			},
		} satisfies AppSchema;
		const values = { note: undefined, text: "", selections: [] };

		expect(describeOptionFields(defaultedSchema, values).fields).toContainEqual(
			expect.objectContaining({ key: "note", required: true }),
		);
		expect(validateOptionValues(defaultedSchema, values).get("note")).toBe(
			"Defaults make note required",
		);
		expect(toOptionsPayload(defaultedSchema, values)).toEqual({});
	});

	it("restores nonblank default semantics when the UI value is cleared", () => {
		const defaultedSchema = {
			rules: [
				{
					path: ["note"],
					kind: "validation",
					validation: { required: true },
					when: { operator: "eq", path: ["region"], value: "us" },
				},
			],
			fields: {
				note: { ...described("Note"), type: "string" },
				region: {
					...described("Region"),
					type: "enum",
					defaultValue: "us",
					choices: { kind: "static", values: [{ value: "us" }, { value: "uk" }] },
				},
			},
		} satisfies AppSchema;

		expect(validateOptionValues(defaultedSchema, { region: "uk" }).has("note")).toBe(false);
		expect(validateOptionValues(defaultedSchema, { region: "" }).has("note")).toBe(true);
		expect(toOptionsPayload(defaultedSchema, { region: "" })).toEqual({});
	});

	it("prefers an active conditional message for a statically required field", () => {
		const requiredSchema = {
			rules: [
				{
					path: ["title"],
					kind: "validation",
					validation: { required: true },
					message: "A UK title is required",
					when: { operator: "eq", path: ["region"], value: "uk" },
				},
			],
			fields: {
				region: { ...described("Region"), type: "string" },
				title: { ...described("Title"), type: "string", validation: { required: true } },
			},
		} satisfies AppSchema;

		expect(validateOptionValues(requiredSchema, { title: "", region: "uk" }).get("title")).toBe(
			"A UK title is required",
		);
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

	it.each([
		["empty text", ""],
		["empty selection", []],
	] as const)("treats %s as absent for exists and not_exists", (_name, blank) => {
		const conditional = (operator: "exists" | "not_exists") => {
			const trigger =
				typeof blank === "string"
					? ({ ...described("Trigger"), type: "string" } as const)
					: ({
							...described("Trigger"),
							type: "enum-array",
							choices: { kind: "static", values: [] },
						} as const);
			return {
				fields: { trigger, note: { ...described("Note"), type: "string" } },
				rules: [
					{
						path: ["note"],
						kind: "validation",
						validation: { required: true },
						when: { operator, path: ["trigger"] },
					},
				],
			} satisfies AppSchema;
		};
		const values = { trigger: blank, note: undefined };

		expect(validateOptionValues(conditional("exists"), values).get("note")).toBeUndefined();
		expect(validateOptionValues(conditional("not_exists"), values).get("note")).toBe(
			"Note is required",
		);
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

	it("omits hidden values from the payload", () => {
		expect(toOptionsPayload(visibilitySchema, { advanced: false, secret: "retained" })).toEqual({
			advanced: false,
		});
		expect(toOptionsPayload(visibilitySchema, { advanced: true, secret: "included" })).toEqual({
			advanced: true,
			secret: "included",
		});
	});
});
