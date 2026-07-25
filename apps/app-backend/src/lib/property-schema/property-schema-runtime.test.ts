import { imagesField, videosField } from "@ryot/contract/schema/core";
import type {
	AppArrayProperty,
	AppBooleanProperty,
	AppDateProperty,
	AppDateTimeProperty,
	AppEnumArrayProperty,
	AppEnumProperty,
	AppIntegerProperty,
	AppNumberProperty,
	AppObjectProperty,
	AppPropertyDefinition,
	AppSchema,
	AppSchemaRule,
	AppSchemaRuleCondition,
	AppStringProperty,
} from "@ryot/contract/schema/property-schema";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
	formatPropertyIssues,
	getAppPropertyDefinitionAtPath,
	parseAppSchemaProperties,
	parseAppSchemaPropertiesSafe,
	validateAppSchemaDefinition,
} from "./property-schema-runtime";

const str = (overrides: Partial<AppStringProperty> = {}): AppPropertyDefinition => ({
	label: "F",
	type: "string",
	description: "F",
	...overrides,
});

const num = (overrides: Partial<AppNumberProperty> = {}): AppPropertyDefinition => ({
	label: "F",
	type: "number",
	description: "F",
	...overrides,
});

const int = (overrides: Partial<AppIntegerProperty> = {}): AppPropertyDefinition => ({
	label: "F",
	type: "integer",
	description: "F",
	...overrides,
});

const bool = (overrides: Partial<AppBooleanProperty> = {}): AppPropertyDefinition => ({
	label: "F",
	type: "boolean",
	description: "F",
	...overrides,
});

const date = (overrides: Partial<AppDateProperty> = {}): AppPropertyDefinition => ({
	label: "F",
	type: "date",
	description: "F",
	...overrides,
});

const datetime = (overrides: Partial<AppDateTimeProperty> = {}): AppPropertyDefinition => ({
	label: "F",
	type: "datetime",
	description: "F",
	...overrides,
});

const enumProp = (
	options: string[],
	overrides: Partial<AppEnumProperty> = {},
): AppPropertyDefinition => ({
	options,
	label: "F",
	type: "enum",
	description: "F",
	...overrides,
});

const enumArrayProp = (
	options: string[],
	overrides: Partial<AppEnumArrayProperty> = {},
): AppPropertyDefinition => ({
	options,
	label: "F",
	description: "F",
	type: "enum-array",
	...overrides,
});

const arrayProp = (
	items: AppPropertyDefinition,
	overrides: Partial<AppArrayProperty> = {},
): AppPropertyDefinition => ({
	items,
	label: "F",
	type: "array",
	description: "F",
	...overrides,
});

const objectProp = (
	properties: Record<string, AppPropertyDefinition>,
	overrides: Partial<AppObjectProperty> = {},
): AppObjectProperty => ({
	label: "F",
	properties,
	type: "object",
	description: "F",
	...overrides,
});

const schema = (
	fields: Record<string, AppPropertyDefinition>,
	extra: Partial<AppSchema> = {},
): AppSchema => ({ fields, ...extra });

const parse = (fields: Record<string, AppPropertyDefinition>, properties: unknown) =>
	parseAppSchemaPropertiesSafe({ properties, propertiesSchema: schema(fields) });

const requiredRule = (targetPath: string[], condition: AppSchemaRuleCondition): AppSchemaRule => ({
	when: condition,
	path: targetPath,
	kind: "validation",
	validation: { required: true },
});

describe("parseAppSchemaPropertiesSafe - non-object input", () => {
	it("fails when properties is a string", () => {
		const result = parse({ name: str() }, "hello");
		expect(result.success).toBe(false);
	});

	it("fails when properties is null", () => {
		const result = parse({ name: str() }, null);
		expect(result.success).toBe(false);
	});

	it("fails when properties is an array with a hint in the message", () => {
		const result = parse({ name: str() }, []);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(formatPropertyIssues(result.issues)).toContain("not an array");
		}
	});

	it("includes the kind in the error message when provided", () => {
		const result = parseAppSchemaPropertiesSafe({
			kind: "Event",
			properties: [],
			propertiesSchema: schema({ name: str() }),
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues[0]?.message).toContain("Event");
		}
	});
});

describe("parseAppSchemaPropertiesSafe - managed assets", () => {
	it("accepts the local, S3, and remote asset variants", () => {
		const result = parse(
			{ images: imagesField("Images"), videos: videosField("Videos") },
			{
				videos: [{ type: "local", key: "permanent/video.mp4" }],
				images: [
					{ type: "local", key: "permanent/image.jpg" },
					{ type: "s3", key: "permanent/image.jpg" },
					{ type: "remote", url: "https://example.com/image.jpg" },
				],
			},
		);

		expect(result).toMatchObject({ success: true });
	});

	it("rejects an asset provider outside the canonical union", () => {
		const result = parse(
			{ images: imagesField("Images") },
			{ images: [{ type: "unknown", key: "permanent/image.jpg" }] },
		);

		expect(result.success).toBe(false);
	});

	it("requires the locator field for each asset variant", () => {
		const fields = { images: imagesField("Images") };
		expect(parse(fields, { images: [{ type: "local" }] }).success).toBe(false);
		expect(parse(fields, { images: [{ type: "remote" }] }).success).toBe(false);
		expect(
			parse(fields, {
				images: [{ type: "remote", url: "https://example.com/image.jpg", key: "key" }],
			}).success,
		).toBe(false);
	});
});

describe("parseAppSchemaPropertiesSafe - string property", () => {
	it("accepts a valid string", () => {
		const result = parse({ name: str() }, { name: "Alice" });
		expect(result).toMatchObject({ success: true, data: { name: "Alice" } });
	});

	it("accepts null for an optional string", () => {
		const result = parse({ name: str() }, { name: null });
		expect(result).toMatchObject({ success: true, data: { name: null } });
	});

	it("rejects null for a required string", () => {
		const result = parse({ name: str({ validation: { required: true } }) }, { name: null });
		expect(result.success).toBe(false);
	});

	it("uses stable missing-key messages for structured and aggregate errors", () => {
		const error = Effect.runSync(
			Effect.flip(
				parseAppSchemaProperties({
					kind: "Entity",
					properties: {},
					propertiesSchema: schema({ name: str({ validation: { required: true } }) }),
				}),
			),
		);

		expect(error.issues).toEqual([{ path: ["name"], message: "is missing" }]);
		expect(error.message).toBe("name: is missing");
	});

	it("enforces minLength", () => {
		const field = str({ validation: { minLength: 3 } });
		expect(parse({ s: field }, { s: "ab" }).success).toBe(false);
		expect(parse({ s: field }, { s: "abc" }).success).toBe(true);
	});

	it("enforces maxLength", () => {
		const field = str({ validation: { maxLength: 3 } });
		expect(parse({ s: field }, { s: "abcd" }).success).toBe(false);
		expect(parse({ s: field }, { s: "abc" }).success).toBe(true);
	});

	it("enforces pattern", () => {
		const field = str({ validation: { pattern: "^\\d+$" } });
		expect(parse({ s: field }, { s: "abc" }).success).toBe(false);
		expect(parse({ s: field }, { s: "123" }).success).toBe(true);
	});

	it("applies the defaultValue when the field is absent", () => {
		const field = str({ defaultValue: "default" });
		const result = parse({ name: field }, {});
		expect(result).toMatchObject({ success: true, data: { name: "default" } });
	});
});

describe("parseAppSchemaPropertiesSafe - number property", () => {
	it("accepts a valid number", () => {
		const result = parse({ n: num() }, { n: 3.14 });
		expect(result).toMatchObject({ success: true, data: { n: 3.14 } });
	});

	it("accepts null for an optional number", () => {
		const result = parse({ n: num() }, { n: null });
		expect(result).toMatchObject({ success: true, data: { n: null } });
	});

	it("enforces minimum", () => {
		const field = num({ validation: { minimum: 0 } });
		expect(parse({ n: field }, { n: -1 }).success).toBe(false);
		expect(parse({ n: field }, { n: 0 }).success).toBe(true);
	});

	it("enforces maximum", () => {
		const field = num({ validation: { maximum: 100 } });
		expect(parse({ n: field }, { n: 101 }).success).toBe(false);
		expect(parse({ n: field }, { n: 100 }).success).toBe(true);
	});

	it("enforces exclusiveMinimum", () => {
		const field = num({ validation: { exclusiveMinimum: 0 } });
		expect(parse({ n: field }, { n: 0 }).success).toBe(false);
		expect(parse({ n: field }, { n: 0.001 }).success).toBe(true);
	});

	it("enforces exclusiveMaximum", () => {
		const field = num({ validation: { exclusiveMaximum: 100 } });
		expect(parse({ n: field }, { n: 100 }).success).toBe(false);
		expect(parse({ n: field }, { n: 99.999 }).success).toBe(true);
	});

	it("applies half-up rounding at the specified scale", () => {
		const field = num({ transform: { round: { mode: "half_up", scale: 2 } } });
		const result = parse({ n: field }, { n: 25.555 });
		expect(result).toMatchObject({ success: true, data: { n: 25.56 } });
	});

	it("rounds down correctly at the specified scale", () => {
		const field = num({ transform: { round: { mode: "half_up", scale: 1 } } });
		const result = parse({ n: field }, { n: 2.44 });
		expect(result).toMatchObject({ success: true, data: { n: 2.4 } });
	});
});

describe("parseAppSchemaPropertiesSafe - integer property", () => {
	it("accepts an integer value", () => {
		const result = parse({ n: int() }, { n: 5 });
		expect(result).toMatchObject({ success: true, data: { n: 5 } });
	});

	it("rejects a non-integer number", () => {
		const result = parse({ n: int() }, { n: 5.5 });
		expect(result.success).toBe(false);
	});
});

describe("parseAppSchemaPropertiesSafe - boolean property", () => {
	it("accepts true", () => {
		expect(parse({ b: bool() }, { b: true })).toMatchObject({ success: true, data: { b: true } });
	});

	it("accepts false", () => {
		expect(parse({ b: bool() }, { b: false })).toMatchObject({
			success: true,
			data: { b: false },
		});
	});

	it("rejects a non-boolean value", () => {
		expect(parse({ b: bool() }, { b: "true" }).success).toBe(false);
	});
});

describe("parseAppSchemaPropertiesSafe - date property", () => {
	it("accepts a valid ISO 8601 date string", () => {
		const result = parse({ d: date() }, { d: "2024-01-15" });
		expect(result).toMatchObject({ success: true, data: { d: "2024-01-15" } });
	});

	it("rejects an invalid date string", () => {
		expect(parse({ d: date() }, { d: "not-a-date" }).success).toBe(false);
	});

	it("rejects a datetime string (requires date-only format)", () => {
		expect(parse({ d: date() }, { d: "2024-01-15T10:00:00Z" }).success).toBe(false);
	});
});

describe("parseAppSchemaPropertiesSafe - datetime property", () => {
	it("accepts a valid ISO 8601 datetime string", () => {
		const result = parse({ dt: datetime() }, { dt: "2024-01-15T10:00:00Z" });
		expect(result).toMatchObject({ success: true, data: { dt: "2024-01-15T10:00:00Z" } });
	});

	it("rejects an invalid datetime string", () => {
		expect(parse({ dt: datetime() }, { dt: "not-a-datetime" }).success).toBe(false);
	});
});

describe("parseAppSchemaPropertiesSafe - enum property", () => {
	it("accepts a value that is in the options list", () => {
		const result = parse({ status: enumProp(["active", "inactive"]) }, { status: "active" });
		expect(result).toMatchObject({ success: true, data: { status: "active" } });
	});

	it("rejects a value not in the options list", () => {
		const result = parse({ status: enumProp(["active", "inactive"]) }, { status: "pending" });
		expect(result.success).toBe(false);
	});
});

describe("parseAppSchemaPropertiesSafe - enum-array property", () => {
	it("accepts an array of valid option values", () => {
		const result = parse({ tags: enumArrayProp(["a", "b", "c"]) }, { tags: ["a", "c"] });
		expect(result).toMatchObject({ success: true, data: { tags: ["a", "c"] } });
	});

	it("rejects items not in the options list", () => {
		const result = parse({ tags: enumArrayProp(["a", "b"]) }, { tags: ["a", "z"] });
		expect(result.success).toBe(false);
	});

	it("enforces minItems", () => {
		const field = enumArrayProp(["a", "b"], { validation: { minItems: 2 } });
		expect(parse({ tags: field }, { tags: ["a"] }).success).toBe(false);
		expect(parse({ tags: field }, { tags: ["a", "b"] }).success).toBe(true);
	});

	it("enforces maxItems", () => {
		const field = enumArrayProp(["a", "b", "c"], { validation: { maxItems: 2 } });
		expect(parse({ tags: field }, { tags: ["a", "b", "c"] }).success).toBe(false);
		expect(parse({ tags: field }, { tags: ["a", "b"] }).success).toBe(true);
	});
});

describe("parseAppSchemaPropertiesSafe - array property", () => {
	it("accepts an array of valid items", () => {
		const result = parse({ items: arrayProp(str()) }, { items: ["x", "y"] });
		expect(result).toMatchObject({ success: true, data: { items: ["x", "y"] } });
	});

	it("rejects items that fail the item schema", () => {
		const field = arrayProp(int());
		const result = parse({ items: field }, { items: [1, "not-an-int"] });
		expect(result.success).toBe(false);
	});

	it("enforces minItems on array", () => {
		const field = arrayProp(str(), { validation: { minItems: 2 } });
		expect(parse({ items: field }, { items: ["a"] }).success).toBe(false);
		expect(parse({ items: field }, { items: ["a", "b"] }).success).toBe(true);
	});
});

describe("parseAppSchemaPropertiesSafe - object property", () => {
	it("accepts a valid nested object", () => {
		const field = objectProp({ name: str() });
		const result = parse({ meta: field }, { meta: { name: "test" } });
		expect(result).toMatchObject({ success: true, data: { meta: { name: "test" } } });
	});

	it("rejects extra keys under the strict policy", () => {
		const field = objectProp({ name: str() }, { unknownKeys: "strict" });
		const result = parse({ meta: field }, { meta: { name: "test", extra: true } });
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(formatPropertyIssues(result.issues)).toContain("extra");
		}
	});

	it("passes extra keys through under the passthrough policy", () => {
		const field = objectProp({ name: str() }, { unknownKeys: "passthrough" });
		const result = parse({ meta: field }, { meta: { name: "test", extra: true } });
		expect(result).toMatchObject({ success: true, data: { meta: { name: "test", extra: true } } });
	});
});

describe("parseAppSchemaPropertiesSafe - rule conditions", () => {
	it("eq: enforces required when condition matches", () => {
		const s = schema(
			{ status: str(), progress: num() },
			{
				rules: [requiredRule(["progress"], { operator: "eq", path: ["status"], value: "done" })],
			},
		);

		const match = parseAppSchemaPropertiesSafe({
			propertiesSchema: s,
			properties: { status: "done" },
		});
		expect(match.success).toBe(false);

		const noMatch = parseAppSchemaPropertiesSafe({
			propertiesSchema: s,
			properties: { status: "draft" },
		});
		expect(noMatch.success).toBe(true);
	});

	it("treats null as missing for a conditionally required property", () => {
		const s = schema(
			{ status: str(), progress: num() },
			{
				rules: [requiredRule(["progress"], { operator: "eq", path: ["status"], value: "done" })],
			},
		);

		expect(
			parseAppSchemaPropertiesSafe({
				propertiesSchema: s,
				properties: { status: "done", progress: null },
			}).success,
		).toBe(false);
	});

	it("neq: enforces required when value is different from condition", () => {
		const s = schema(
			{ status: str(), progress: num() },
			{
				rules: [requiredRule(["progress"], { operator: "neq", path: ["status"], value: "draft" })],
			},
		);

		expect(
			parseAppSchemaPropertiesSafe({ properties: { status: "active" }, propertiesSchema: s })
				.success,
		).toBe(false);

		expect(
			parseAppSchemaPropertiesSafe({ properties: { status: "draft" }, propertiesSchema: s })
				.success,
		).toBe(true);
	});

	it("in: enforces required when value is one of the provided set", () => {
		const s = schema(
			{ status: str(), progress: num() },
			{
				rules: [
					requiredRule(["progress"], {
						operator: "in",
						path: ["status"],
						value: ["active", "done"],
					}),
				],
			},
		);

		expect(
			parseAppSchemaPropertiesSafe({ properties: { status: "active" }, propertiesSchema: s })
				.success,
		).toBe(false);

		expect(
			parseAppSchemaPropertiesSafe({ properties: { status: "draft" }, propertiesSchema: s })
				.success,
		).toBe(true);
	});

	it("not_in: enforces required when value is not in the provided set", () => {
		const s = schema(
			{ status: str(), progress: num() },
			{
				rules: [
					requiredRule(["progress"], {
						path: ["status"],
						value: ["draft"],
						operator: "not_in",
					}),
				],
			},
		);

		expect(
			parseAppSchemaPropertiesSafe({ properties: { status: "active" }, propertiesSchema: s })
				.success,
		).toBe(false);

		expect(
			parseAppSchemaPropertiesSafe({ properties: { status: "draft" }, propertiesSchema: s })
				.success,
		).toBe(true);
	});

	it("exists: enforces required when the condition path has any value", () => {
		const s = schema(
			{ note: str(), progress: num() },
			{
				rules: [requiredRule(["progress"], { operator: "exists", path: ["note"] })],
			},
		);

		expect(
			parseAppSchemaPropertiesSafe({ properties: { note: "hi" }, propertiesSchema: s }).success,
		).toBe(false);

		expect(parseAppSchemaPropertiesSafe({ properties: {}, propertiesSchema: s }).success).toBe(
			true,
		);
	});

	it("not_exists: enforces required when the condition path is absent", () => {
		const s = schema(
			{ note: str(), progress: num() },
			{
				rules: [requiredRule(["progress"], { operator: "not_exists", path: ["note"] })],
			},
		);

		expect(parseAppSchemaPropertiesSafe({ properties: {}, propertiesSchema: s }).success).toBe(
			false,
		);

		expect(
			parseAppSchemaPropertiesSafe({ properties: { note: "hi" }, propertiesSchema: s }).success,
		).toBe(true);
	});

	it("all: requires all sub-conditions to be true", () => {
		const s = schema(
			{ a: str(), b: str(), progress: num() },
			{
				rules: [
					requiredRule(["progress"], {
						operator: "all",
						conditions: [
							{ operator: "eq", path: ["a"], value: "yes" },
							{ operator: "eq", path: ["b"], value: "yes" },
						],
					}),
				],
			},
		);

		expect(
			parseAppSchemaPropertiesSafe({ properties: { a: "yes", b: "yes" }, propertiesSchema: s })
				.success,
		).toBe(false);

		expect(
			parseAppSchemaPropertiesSafe({ properties: { a: "yes", b: "no" }, propertiesSchema: s })
				.success,
		).toBe(true);
	});

	it("any: requires at least one sub-condition to be true", () => {
		const s = schema(
			{ a: str(), b: str(), progress: num() },
			{
				rules: [
					requiredRule(["progress"], {
						operator: "any",
						conditions: [
							{ operator: "eq", path: ["a"], value: "yes" },
							{ operator: "eq", path: ["b"], value: "yes" },
						],
					}),
				],
			},
		);

		expect(
			parseAppSchemaPropertiesSafe({ properties: { a: "yes", b: "no" }, propertiesSchema: s })
				.success,
		).toBe(false);

		expect(
			parseAppSchemaPropertiesSafe({ properties: { a: "no", b: "no" }, propertiesSchema: s })
				.success,
		).toBe(true);
	});

	it("uses the rule message when provided", () => {
		const s = schema(
			{ status: str(), progress: num() },
			{
				rules: [
					{
						kind: "validation",
						path: ["progress"],
						validation: { required: true },
						message: "progress is required when done",
						when: { operator: "eq", path: ["status"], value: "done" },
					},
				],
			},
		);

		const result = parseAppSchemaPropertiesSafe({
			properties: { status: "done" },
			propertiesSchema: s,
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(formatPropertyIssues(result.issues)).toContain("progress is required when done");
		}
	});
});

describe("validateAppSchemaDefinition", () => {
	it("returns no issues for a valid schema with no rules", () => {
		const issues = validateAppSchemaDefinition(schema({ name: str() }));
		expect(issues).toEqual([]);
	});

	it("returns no issues for a valid rule referencing an existing field", () => {
		const s = schema(
			{ status: str(), progress: num() },
			{
				rules: [
					{
						kind: "validation",
						path: ["progress"],
						validation: { required: true },
						when: { operator: "eq", path: ["status"], value: "done" },
					},
				],
			},
		);
		expect(validateAppSchemaDefinition(s)).toEqual([]);
	});

	it("returns an issue when the rule path points to a missing field", () => {
		const s = schema(
			{ status: str() },
			{
				rules: [
					{
						kind: "validation",
						path: ["nonexistent"],
						validation: { required: true },
						when: { operator: "eq", path: ["status"], value: "done" },
					},
				],
			},
		);
		const issues = validateAppSchemaDefinition(s);
		expect(issues).toHaveLength(1);
		expect(issues[0]?.message).toContain("nonexistent");
	});

	it("returns an issue when the condition path points to a missing field", () => {
		const s = schema(
			{ progress: num() },
			{
				rules: [
					{
						kind: "validation",
						path: ["progress"],
						validation: { required: true },
						when: { operator: "eq", path: ["missingField"], value: "done" },
					},
				],
			},
		);
		const issues = validateAppSchemaDefinition(s);
		expect(issues).toHaveLength(1);
		expect(issues[0]?.message).toContain("missingField");
	});

	it("returns an issue when comparing a non-comparable property type", () => {
		const s = schema(
			{ meta: objectProp({ name: str() }), progress: num() },
			{
				rules: [
					{
						kind: "validation",
						path: ["progress"],
						validation: { required: true },
						when: { operator: "eq", path: ["meta"], value: "x" },
					},
				],
			},
		);
		const issues = validateAppSchemaDefinition(s);
		expect(issues.length).toBeGreaterThan(0);
		expect(issues.some((i) => i.message.includes("primitive"))).toBe(true);
	});

	it("returns an issue when a rule condition value type mismatches the property type", () => {
		const s = schema(
			{ count: int(), progress: num() },
			{
				rules: [
					{
						kind: "validation",
						path: ["progress"],
						validation: { required: true },
						when: { operator: "eq", path: ["count"], value: "not-a-number" },
					},
				],
			},
		);
		const issues = validateAppSchemaDefinition(s);
		expect(issues.length).toBeGreaterThan(0);
	});
});

describe("getAppPropertyDefinitionAtPath", () => {
	const meta = objectProp({ title: str(), count: int() });
	const fields = {
		name: str(),
		meta,
	};

	it("returns the definition for a top-level field", () => {
		const result = getAppPropertyDefinitionAtPath(fields, ["name"]);
		expect(result).toEqual(fields.name);
	});

	it("returns the definition for a nested field inside an object", () => {
		const result = getAppPropertyDefinitionAtPath(fields, ["meta", "title"]);
		expect(result).toEqual(meta.properties["title"]);
	});

	it("returns undefined for a missing top-level field", () => {
		expect(getAppPropertyDefinitionAtPath(fields, ["missing"])).toBeUndefined();
	});

	it("returns undefined when the path descends past a non-object field", () => {
		expect(getAppPropertyDefinitionAtPath(fields, ["name", "child"])).toBeUndefined();
	});

	it("returns undefined when the path is empty", () => {
		expect(getAppPropertyDefinitionAtPath(fields, [])).toBeUndefined();
	});
});

describe("formatPropertyIssues", () => {
	it("formats a single issue without a path prefix", () => {
		const formatted = formatPropertyIssues([{ path: [], message: "required" }]);
		expect(formatted).toBe("required");
	});

	it("prefixes issues that have a path", () => {
		const formatted = formatPropertyIssues([{ path: ["meta", "title"], message: "too short" }]);
		expect(formatted).toBe("meta.title: too short");
	});

	it("joins multiple issues with a semicolon", () => {
		const formatted = formatPropertyIssues([
			{ path: [], message: "first error" },
			{ path: ["field"], message: "second error" },
		]);
		expect(formatted).toBe("first error; field: second error");
	});
});
