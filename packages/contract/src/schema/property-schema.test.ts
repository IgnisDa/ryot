import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
	AppSchema,
	evaluateAppSchemaRuleCondition,
	getAppPropertyDefinitionAtPath,
	getAppSchemaValueAtPath,
	getOrderedAppSchemaFieldEntries,
	isAppSchemaPathEffectivelyRequired,
	isAppSchemaPathHidden,
	isMissingAppSchemaRequiredValue,
	materializeAppSchemaChoices,
} from "./property-schema";

const decodeSchema = (value: unknown) => Schema.decodeUnknownSync(AppSchema)(value);

const enumField = (choices: unknown, defaultValue?: unknown) => ({
	choices,
	type: "enum",
	label: "Status",
	...(defaultValue === undefined ? {} : { defaultValue }),
	description: "Status value",
});

const enumArrayField = (choices: unknown, defaultValue?: unknown) => ({
	choices,
	label: "Statuses",
	type: "enum-array",
	...(defaultValue === undefined ? {} : { defaultValue }),
	description: "Status values",
});

const numberField = (extra: Record<string, unknown>) => ({
	...extra,
	type: "number",
	label: "Progress",
	description: "Progress value",
});

describe("AppSchema number normalization", () => {
	it("requires a round definition", () => {
		expect(() => decodeSchema({ fields: { progress: numberField({ normalize: {} }) } })).toThrow();
	});
});

describe("AppSchema presentation metadata", () => {
	it("accepts visibility rules", () => {
		expect(
			decodeSchema({
				rules: [
					{
						path: ["secret"],
						kind: "visibility",
						visibility: { hidden: true },
						when: { value: true, operator: "neq", path: ["advanced"] },
					},
				],
				fields: {
					secret: { type: "string", label: "Secret", description: "An advanced secret" },
					advanced: { type: "boolean", label: "Advanced", description: "Show advanced fields" },
				},
			}),
		).toMatchObject({ rules: [{ kind: "visibility", visibility: { hidden: true } }] });
	});

	it("orders positioned fields stably and leaves position optional", () => {
		const schema = decodeSchema({
			fields: {
				last: { label: "Last", type: "string", description: "Last" },
				alsoLast: { type: "string", label: "Also last", description: "Also last" },
				first: { position: 1, type: "string", label: "First", description: "First" },
				second: { position: 2, type: "string", label: "Second", description: "Second" },
				secondTie: { position: 2, type: "string", label: "Second tie", description: "Second tie" },
			},
		});

		expect(getOrderedAppSchemaFieldEntries(schema.fields).map(([key]) => key)).toEqual([
			"first",
			"second",
			"secondTie",
			"last",
			"alsoLast",
		]);
		expect(schema.fields.last?.position).toBeUndefined();
	});

	it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
		"rejects non-finite positions: %s",
		(position) => {
			expect(() =>
				decodeSchema({
					fields: { value: { position, type: "string", label: "Value", description: "Value" } },
				}),
			).toThrow();
		},
	);

	it.each([
		{ kind: "url" },
		{ kind: "email" },
		{ kind: "upload", allowedFileExtensions: ["csv", "json"] },
	])("accepts the $kind string format", (format) => {
		expect(
			decodeSchema({
				fields: { value: { format, type: "string", label: "Value", description: "A value" } },
			}),
		).toMatchObject({ fields: { value: { format } } });
	});

	it.each(["entity-id", "relationship-id"] as const)(
		"accepts explicit %s reference metadata",
		(kind) => {
			expect(
				decodeSchema({
					fields: {
						value: {
							type: "string",
							label: "Reference",
							description: "Reference value",
							reference: { kind, required: true },
						},
					},
				}),
			).toMatchObject({ fields: { value: { reference: { kind, required: true } } } });
		},
	);

	it.each([{ kind: "entity" }, { required: false, kind: "entity-id" }])(
		"rejects invalid reference metadata %#",
		(reference) => {
			expect(() =>
				decodeSchema({
					fields: {
						value: {
							reference,
							type: "string",
							label: "Reference",
							description: "Reference value",
						},
					},
				}),
			).toThrow();
		},
	);

	it("rejects reference metadata on non-string properties", () => {
		expect(() =>
			decodeSchema({ fields: { value: numberField({ reference: { kind: "entity-id" } }) } }),
		).toThrow();
	});

	it("rejects defaults for upload string formats", () => {
		expect(() =>
			decodeSchema({
				fields: {
					file: {
						label: "File",
						type: "string",
						description: "A file",
						defaultValue: "export.json",
						format: { kind: "upload", allowedFileExtensions: ["json"] },
					},
				},
			}),
		).toThrow();
	});

	it.each([
		{ allowedFileExtensions: [] },
		{ allowedFileExtensions: [""] },
		{ allowedFileExtensions: [" csv"] },
		{ allowedFileExtensions: ["CSV"] },
		{ allowedFileExtensions: [".csv"] },
		{ allowedFileExtensions: ["csv", "csv"] },
	])("rejects invalid upload extensions %#", ({ allowedFileExtensions }) => {
		expect(() =>
			decodeSchema({
				fields: {
					file: {
						label: "File",
						type: "string",
						description: "A file",
						format: { kind: "upload", allowedFileExtensions },
					},
				},
			}),
		).toThrow();
	});
});

describe("AppSchema rule semantics", () => {
	const schema = {
		fields: {
			enabled: { type: "boolean", label: "Enabled", description: "Enabled" },
			settings: {
				type: "object",
				label: "Settings",
				description: "Settings",
				properties: {
					secret: { type: "string", label: "Secret", description: "Secret" },
					required: {
						type: "string",
						label: "Required",
						description: "Required",
						validation: { required: true },
					},
				},
			},
		},
	} satisfies AppSchema;

	it("gets nested values and property definitions", () => {
		expect(getAppSchemaValueAtPath({ settings: { secret: "value" } }, ["settings", "secret"])).toBe(
			"value",
		);
		expect(getAppSchemaValueAtPath({ settings: null }, ["settings", "secret"])).toBeUndefined();
		expect(getAppPropertyDefinitionAtPath(schema.fields, ["settings", "secret"])).toMatchObject({
			type: "string",
			label: "Secret",
		});
		expect(getAppPropertyDefinitionAtPath(schema.fields, ["settings", "missing"])).toBeUndefined();
		expect(getAppPropertyDefinitionAtPath(schema.fields, ["enabled", "nested"])).toBeUndefined();
		expect(getAppPropertyDefinitionAtPath(schema.fields, [])).toBeUndefined();
	});

	it.each([
		["all", { operator: "all", conditions: [{ path: ["present"], operator: "exists" }] }, true],
		[
			"any",
			{
				operator: "any",
				conditions: [
					{ operator: "eq", path: ["status"], value: "inactive" },
					{ path: ["missing"], operator: "not_exists" },
				],
			},
			true,
		],
		["exists", { path: ["present"], operator: "exists" }, true],
		["not_exists", { path: ["undefined"], operator: "not_exists" }, true],
		["exists against null", { operator: "exists", path: ["explicitNull"] }, false],
		["not_exists against null", { operator: "not_exists", path: ["explicitNull"] }, true],
		["eq against null", { value: null, operator: "eq", path: ["explicitNull"] }, true],
		["neq against null", { value: null, operator: "neq", path: ["explicitNull"] }, false],
		["in against null", { operator: "in", value: [null, 1], path: ["explicitNull"] }, true],
		["eq", { operator: "eq", value: Number.NaN, path: ["notANumber"] }, true],
		["neq", { value: 0, operator: "neq", path: ["negativeZero"] }, true],
		["in", { operator: "in", path: ["notANumber"], value: [Number.NaN, 1] }, true],
		["not_in", { value: [0, 1], operator: "not_in", path: ["negativeZero"] }, true],
	] as const)("evaluates %s conditions", (_operator, condition, expected) => {
		expect(
			evaluateAppSchemaRuleCondition(condition, {
				undefined,
				present: "value",
				status: "active",
				negativeZero: -0,
				explicitNull: null,
				notANumber: Number.NaN,
			}),
		).toBe(expected);
	});

	it("hides a path when any exact visibility rule matches", () => {
		const ruleSchema = {
			...schema,
			rules: [
				{
					kind: "visibility",
					path: ["settings", "secret"],
					visibility: { hidden: true },
					when: { value: false, operator: "eq", path: ["enabled"] },
				},
				{
					kind: "visibility",
					path: ["settings", "secret"],
					visibility: { hidden: true },
					when: { value: true, operator: "eq", path: ["enabled"] },
				},
			],
		} satisfies AppSchema;

		expect(isAppSchemaPathHidden(ruleSchema, ["settings", "secret"], { enabled: true })).toBe(true);
		expect(isAppSchemaPathHidden(ruleSchema, ["settings"], { enabled: true })).toBe(false);
	});

	it("hides descendants when an ancestor visibility rule matches", () => {
		const ruleSchema = {
			...schema,
			rules: [
				{
					kind: "visibility",
					path: ["settings"],
					visibility: { hidden: true },
					when: { value: true, operator: "eq", path: ["enabled"] },
				},
			],
		} satisfies AppSchema;
		const input = { enabled: true };

		expect(isAppSchemaPathHidden(ruleSchema, ["settings", "required"], input)).toBe(true);
		expect(isAppSchemaPathEffectivelyRequired(ruleSchema, ["settings", "required"], input)).toBe(
			false,
		);
	});

	it("hidden paths suppress declared and conditional requiredness", () => {
		const ruleSchema = {
			...schema,
			rules: [
				{
					kind: "visibility",
					visibility: { hidden: true },
					path: ["settings", "required"],
					when: { path: ["enabled"], operator: "exists" },
				},
				{
					kind: "visibility",
					path: ["settings", "secret"],
					visibility: { hidden: true },
					when: { path: ["enabled"], operator: "exists" },
				},
				{
					kind: "validation",
					path: ["settings", "secret"],
					validation: { required: true },
					when: { path: ["enabled"], operator: "exists" },
				},
			],
		} satisfies AppSchema;
		const input = { enabled: true };

		expect(isAppSchemaPathEffectivelyRequired(ruleSchema, ["settings", "required"], input)).toBe(
			false,
		);
		expect(isAppSchemaPathEffectivelyRequired(ruleSchema, ["settings", "secret"], input)).toBe(
			false,
		);
	});

	it("applies visible conditional requiredness without inspecting the target value", () => {
		const ruleSchema = {
			...schema,
			rules: [
				{
					kind: "validation",
					path: ["settings", "secret"],
					validation: { required: true },
					when: { value: true, operator: "eq", path: ["enabled"] },
				},
			],
		} satisfies AppSchema;

		expect(
			isAppSchemaPathEffectivelyRequired(ruleSchema, ["settings", "secret"], {
				enabled: true,
				settings: { secret: "already present" },
			}),
		).toBe(true);
		expect(isAppSchemaPathEffectivelyRequired(ruleSchema, ["missing"], { enabled: true })).toBe(
			false,
		);
	});

	it.each([
		[undefined, true],
		[null, true],
		["", false],
		[false, false],
		[0, false],
		[[], false],
	])("identifies missing required values", (value, expected) => {
		expect(isMissingAppSchemaRequiredValue(value)).toBe(expected);
	});
});

describe("AppSchema enum choices", () => {
	it("accepts labeled static and dynamic choices", () => {
		expect(
			decodeSchema({
				fields: {
					region: enumField({ kind: "dynamic", source: "regions" }),
					status: enumField(
						{ kind: "static", values: [{ value: "active", label: "Active" }] },
						"active",
					),
				},
			}),
		).toMatchObject({ fields: { status: { defaultValue: "active" } } });
	});

	it.each([
		{ name: "empty choice values", field: enumField({ values: [], kind: "static" }) },
		{ name: "blank choice value", field: enumField({ kind: "static", values: [{ value: "  " }] }) },
		{
			name: "blank choice label",
			field: enumField({ kind: "static", values: [{ label: " ", value: "active" }] }),
		},
		{
			name: "duplicate choice values",
			field: enumField({ kind: "static", values: [{ value: "active" }, { value: "active" }] }),
		},
		{ name: "blank dynamic source", field: enumField({ source: " ", kind: "dynamic" }) },
		{
			name: "static default outside choices",
			field: enumField({ kind: "static", values: [{ value: "active" }] }, "inactive"),
		},
		{
			name: "dynamic default",
			field: enumField({ kind: "dynamic", source: "statuses" }, "active"),
		},
		{
			name: "enum array default outside choices",
			field: enumArrayField({ kind: "static", values: [{ value: "active" }] }, ["inactive"]),
		},
		{
			name: "enum array dynamic default",
			field: enumArrayField({ kind: "dynamic", source: "statuses" }, ["active"]),
		},
	])("rejects $name", ({ field }) => {
		expect(() => decodeSchema({ fields: { status: field } })).toThrow();
	});

	it("does not accept the removed options property", () => {
		expect(() =>
			decodeSchema({
				fields: {
					status: {
						type: "enum",
						label: "Status",
						options: ["active"],
						description: "Status value",
					},
				},
			}),
		).toThrow();
	});

	it("materializes dynamic choices recursively and preserves static fields", () => {
		const staticField = {
			type: "enum",
			label: "Status",
			description: "Status value",
			choices: { kind: "static", values: [{ value: "active" }] },
		} satisfies AppSchema["fields"][string];
		const schema = {
			fields: {
				static: staticField,
				status: {
					type: "enum",
					label: "Status",
					description: "Status value",
					choices: { kind: "dynamic", source: "statuses" },
				},
				metadata: {
					type: "object",
					label: "Metadata",
					description: "Metadata",
					properties: {
						region: {
							type: "enum",
							label: "Status",
							description: "Status value",
							choices: { kind: "dynamic", source: "regions" },
						},
					},
				},
			},
		} satisfies AppSchema;

		const result = materializeAppSchemaChoices(schema, {
			regions: [{ value: "us", label: "United States" }],
			statuses: [{ value: "active" }, { value: "inactive" }],
		});

		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isSuccess(result)) {
			expect(result.success.fields.static).toBe(staticField);
			expect(result.success.fields.status).toMatchObject({
				choices: { kind: "static", values: [{ value: "active" }, { value: "inactive" }] },
			});
			expect(result.success.fields.metadata).toMatchObject({
				properties: {
					region: {
						choices: { kind: "static", values: [{ value: "us", label: "United States" }] },
					},
				},
			});
		}
	});

	it("reports missing and invalid dynamic choice sources", () => {
		const schema = decodeSchema({
			fields: { status: enumField({ kind: "dynamic", source: "statuses" }) },
		});

		const missing = materializeAppSchemaChoices(schema, {});
		expect(Result.isFailure(missing)).toBe(true);
		if (Result.isFailure(missing)) {
			expect(missing.failure).toEqual([
				{
					source: "statuses",
					path: ["fields", "status", "choices", "source"],
					message: "Choice source 'statuses' for field 'status' was not provided",
				},
			]);
		}

		const invalid = materializeAppSchemaChoices(schema, {
			statuses: [{ value: "active" }, { value: "active" }],
		});
		expect(Result.isFailure(invalid)).toBe(true);
		if (Result.isFailure(invalid)) {
			expect(invalid.failure).toEqual([
				{
					source: "statuses",
					path: ["fields", "status", "choices", "values"],
					message:
						"Choice source 'statuses' for field 'status' contains invalid or duplicate choice values",
				},
			]);
		}
	});
});
