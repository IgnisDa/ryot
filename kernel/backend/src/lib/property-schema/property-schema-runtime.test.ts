import { imagesField, videosField } from "@ryot-app/contract/schema/core";
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
} from "@ryot-app/contract/schema/property-schema";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
	formatPropertyIssues,
	parseAppSchemaProperties,
	parseAppSchemaPropertiesSafe,
	validateAppSchemaDefinition,
} from "./property-schema-runtime";
import { fixtureExamplePropertiesSchema } from "./property-schema.test-fixture";

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
	values: string[],
	overrides: Partial<AppEnumProperty> = {},
): AppPropertyDefinition => ({
	label: "F",
	type: "enum",
	description: "F",
	choices: { kind: "static", values: values.map((value) => ({ value })) },
	...overrides,
});

const enumArrayProp = (
	values: string[],
	overrides: Partial<AppEnumArrayProperty> = {},
): AppPropertyDefinition => ({
	label: "F",
	description: "F",
	type: "enum-array",
	choices: { kind: "static", values: values.map((value) => ({ value })) },
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

const parseItem = (properties: unknown) =>
	parseAppSchemaPropertiesSafe({ properties, propertiesSchema: fixtureExamplePropertiesSchema });

const requiredRule = (targetPath: string[], condition: AppSchemaRuleCondition): AppSchemaRule => ({
	when: condition,
	path: targetPath,
	kind: "validation",
	validation: { required: true },
});

const visibilityRule = (
	targetPath: string[],
	condition: AppSchemaRuleCondition,
): AppSchemaRule => ({
	when: condition,
	path: targetPath,
	kind: "visibility",
	visibility: { hidden: true },
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

describe("parseAppSchemaPropertiesSafe - example images", () => {
	it("accepts remote, local, and S3 image locators with purposes", () => {
		const result = parseItem({
			images: [
				{ type: "remote", url: "https://example.com/cover.jpg", purpose: "cover" },
				{ type: "local", key: "permanent/backdrop.jpg", purpose: "backdrop" },
				{ type: "s3", key: "permanent/still.jpg", purpose: "still" },
			],
		});

		expect(result.success).toBe(true);
	});

	it("rejects an example image without a purpose", () => {
		const result = parseItem({
			images: [{ type: "remote", url: "https://example.com/image.jpg" }],
		});

		expect(result.success).toBe(false);
	});

	it("rejects an unknown example image purpose", () => {
		const result = parseItem({
			images: [{ type: "remote", url: "https://example.com/image.jpg", purpose: "thumbnail" }],
		});

		expect(result.success).toBe(false);
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

	it("validates URL and email formats", () => {
		expect(
			parse({ value: str({ format: { kind: "url" } }) }, { value: "https://example.com" }).success,
		).toBe(true);
		expect(
			parse({ value: str({ format: { kind: "url" } }) }, { value: "ftp://example.com" }).success,
		).toBe(false);
		expect(
			parse({ value: str({ format: { kind: "email" } }) }, { value: "person@example.com" }).success,
		).toBe(true);
		expect(parse({ value: str({ format: { kind: "email" } }) }, { value: "invalid" }).success).toBe(
			false,
		);
	});

	it("accepts a bare temporary upload token string", () => {
		const field = str({ format: { kind: "upload", allowedFileExtensions: ["pdf"] } });
		const result = parse({ attachment: field }, { attachment: "temporary-token" });

		expect(result).toMatchObject({ success: true, data: { attachment: "temporary-token" } });
	});

	it("rejects a temporary upload token carried as an object", () => {
		const field = str({ format: { kind: "upload", allowedFileExtensions: ["pdf"] } });

		expect(
			parse(
				{ attachment: field },
				{ attachment: { token: "temporary-token", expiresAt: "2026-08-23T12:00:00Z" } },
			).success,
		).toBe(false);
		expect(parse({ attachment: field }, { attachment: { token: "temporary-token" } }).success).toBe(
			false,
		);
	});

	it("applies string validation to an upload token", () => {
		const field = str({
			validation: { pattern: "^upload_" },
			format: { kind: "upload", allowedFileExtensions: ["pdf"] },
		});

		expect(parse({ attachment: field }, { attachment: "invalid" }).success).toBe(false);
		expect(parse({ attachment: field }, { attachment: "upload_valid" }).success).toBe(true);
	});

	it("rejects an empty token for a required upload field", () => {
		const field = str({
			validation: { minLength: 1, required: true },
			format: { kind: "upload", allowedFileExtensions: ["pdf"] },
		});

		expect(parse({ attachment: field }, { attachment: "" }).success).toBe(false);
		expect(parse({ attachment: field }, { attachment: "token" }).success).toBe(true);
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

	it("applies half-up normalization at the specified scale", () => {
		const field = num({ normalize: { round: { scale: 2 } } });
		const result = parse({ n: field }, { n: 25.555 });
		expect(result).toMatchObject({ success: true, data: { n: 25.56 } });
	});

	it("applies normalization at scale 1", () => {
		const field = num({ normalize: { round: { scale: 1 } } });
		const result = parse({ n: field }, { n: 2.44 });
		expect(result).toMatchObject({ success: true, data: { n: 2.4 } });
	});

	it("normalizes before maximum validation", () => {
		const field = num({ normalize: { round: { scale: 2 } }, validation: { maximum: 100 } });
		const result = parse({ n: field }, { n: 100.004 });
		expect(result).toMatchObject({ success: true, data: { n: 100 } });
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
	it("accepts a value that is in the choices list", () => {
		const result = parse({ status: enumProp(["active", "inactive"]) }, { status: "active" });
		expect(result).toMatchObject({ success: true, data: { status: "active" } });
	});

	it("matches enum values independently from display labels", () => {
		const result = parse(
			{
				status: enumProp(["internal"], {
					choices: { kind: "static", values: [{ value: "internal", label: "Internal" }] },
				}),
			},
			{ status: "internal" },
		);

		expect(result.success).toBe(true);
	});

	it("rejects a value not in the choices list", () => {
		const result = parse({ status: enumProp(["active", "inactive"]) }, { status: "pending" });
		expect(result.success).toBe(false);
	});

	it("rejects unresolved dynamic choices before parsing values", () => {
		const result = parse(
			{ status: enumProp(["active"], { choices: { kind: "dynamic", source: "statuses" } }) },
			{ status: "active" },
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues[0]).toEqual({
				path: ["status", "choices", "source"],
				message: "Dynamic choices for 'status' must be materialized before property parsing",
			});
		}
	});
});

describe("parseAppSchemaPropertiesSafe - enum-array property", () => {
	it("accepts an array of valid choice values", () => {
		const result = parse({ tags: enumArrayProp(["a", "b", "c"]) }, { tags: ["a", "c"] });
		expect(result).toMatchObject({ success: true, data: { tags: ["a", "c"] } });
	});

	it("rejects items not in the choices list", () => {
		const result = parse({ tags: enumArrayProp(["a", "b"]) }, { tags: ["a", "z"] });
		expect(result.success).toBe(false);
	});

	it("rejects unresolved dynamic choices before parsing items", () => {
		const result = parse(
			{ tags: enumArrayProp(["a"], { choices: { kind: "dynamic", source: "tags" } }) },
			{ tags: ["a"] },
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues[0]?.message).toBe(
				"Dynamic choices for 'tags' must be materialized before property parsing",
			);
		}
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

	it("enforces required validation on array items", () => {
		const field = arrayProp(str({ validation: { required: true } }));
		expect(parse({ items: field }, { items: [null] }).success).toBe(false);
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
	it("allows an omitted required property while it is hidden", () => {
		const s = schema(
			{ enabled: bool(), secret: str({ validation: { required: true } }) },
			{ rules: [visibilityRule(["secret"], { operator: "eq", path: ["enabled"], value: false })] },
		);

		expect(
			parseAppSchemaPropertiesSafe({ properties: { enabled: false }, propertiesSchema: s }),
		).toEqual({ success: true, data: { enabled: false } });
	});

	it("rejects a submitted hidden property with the rule message", () => {
		const rule = visibilityRule(["secret"], {
			value: false,
			operator: "eq",
			path: ["enabled"],
		});
		const s = schema(
			{ enabled: bool(), secret: str() },
			{ rules: [{ ...rule, message: "secret is not accepted while disabled" }] },
		);
		const result = parseAppSchemaPropertiesSafe({
			propertiesSchema: s,
			properties: { enabled: false, secret: "submitted" },
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues).toEqual([
				{ path: ["secret"], message: "secret is not accepted while disabled" },
			]);
		}
	});

	it("rejects a type-invalid hidden property with the visibility message", () => {
		const rule = visibilityRule(["secret"], { value: false, operator: "eq", path: ["enabled"] });
		const s = schema(
			{ enabled: bool(), secret: str() },
			{ rules: [{ ...rule, message: "secret is not accepted while disabled" }] },
		);
		const result = parseAppSchemaPropertiesSafe({
			propertiesSchema: s,
			properties: { enabled: false, secret: 42 },
		});

		expect(result).toEqual({
			success: false,
			issues: [{ path: ["secret"], message: "secret is not accepted while disabled" }],
		});
	});

	it("suppresses nested required fields under a hidden ancestor", () => {
		const s = schema(
			{
				enabled: bool(),
				settings: objectProp({ secret: str({ validation: { required: true } }) }),
			},
			{
				rules: [visibilityRule(["settings"], { operator: "eq", path: ["enabled"], value: false })],
			},
		);

		expect(
			parseAppSchemaPropertiesSafe({ propertiesSchema: s, properties: { enabled: false } }),
		).toEqual({ success: true, data: { enabled: false } });
	});

	it("lets visibility override both property and conditional requiredness", () => {
		const fields = { status: str(), secret: str({ validation: { required: true } }) };
		const s = schema(fields, {
			rules: [
				requiredRule(["secret"], { operator: "eq", path: ["status"], value: "hidden" }),
				visibilityRule(["secret"], { operator: "eq", value: "hidden", path: ["status"] }),
			],
		});

		expect(
			parseAppSchemaPropertiesSafe({ properties: { status: "hidden" }, propertiesSchema: s })
				.success,
		).toBe(true);
		expect(
			parseAppSchemaPropertiesSafe({ properties: { status: "visible" }, propertiesSchema: s })
				.success,
		).toBe(false);
	});

	it("evaluates visibility from defaults and omits a hidden generated default", () => {
		const s = schema(
			{ status: str({ defaultValue: "hidden" }), secret: str({ defaultValue: "generated" }) },
			{
				rules: [visibilityRule(["secret"], { operator: "eq", value: "hidden", path: ["status"] })],
			},
		);

		expect(parseAppSchemaPropertiesSafe({ properties: {}, propertiesSchema: s })).toEqual({
			success: true,
			data: { status: "hidden" },
		});
	});

	it("eq: enforces required when condition matches", () => {
		const s = schema(
			{ status: str(), progress: num() },
			{ rules: [requiredRule(["progress"], { operator: "eq", path: ["status"], value: "done" })] },
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
			{ rules: [requiredRule(["progress"], { operator: "eq", path: ["status"], value: "done" })] },
		);

		expect(
			parseAppSchemaPropertiesSafe({
				propertiesSchema: s,
				properties: { status: "done", progress: null },
			}).success,
		).toBe(false);
	});

	it("enforces a conditionally required nested property when its parent is absent", () => {
		const s = schema(
			{ status: str(), metadata: objectProp({ progress: num() }) },
			{
				rules: [
					requiredRule(["metadata", "progress"], {
						value: "done",
						operator: "eq",
						path: ["status"],
					}),
				],
			},
		);

		expect(
			parseAppSchemaPropertiesSafe({ properties: { status: "done" }, propertiesSchema: s }).success,
		).toBe(false);
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

	it("prefers a conditional rule message over a declared required message", () => {
		const s = schema(
			{ status: str(), progress: num({ validation: { required: true } }) },
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

		expect(result).toEqual({
			success: false,
			issues: [{ path: ["progress"], message: "progress is required when done" }],
		});
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

	it("validates visibility target and condition paths", () => {
		const missingTarget = schema(
			{ status: str() },
			{
				rules: [
					visibilityRule(["nonexistent"], { operator: "eq", value: "hidden", path: ["status"] }),
				],
			},
		);
		const missingCondition = schema(
			{ secret: str() },
			{
				rules: [
					visibilityRule(["secret"], { operator: "eq", value: "hidden", path: ["nonexistent"] }),
				],
			},
		);

		expect(validateAppSchemaDefinition(missingTarget)[0]?.message).toContain("nonexistent");
		expect(validateAppSchemaDefinition(missingCondition)[0]?.message).toContain("nonexistent");
	});

	it("rejects nested upload declarations unless explicitly allowed", () => {
		const upload = str({
			format: { kind: "upload", allowedFileExtensions: ["pdf"] },
		});
		const s = schema({ metadata: objectProp({ attachments: arrayProp(upload) }) });

		expect(validateAppSchemaDefinition(s)).toEqual([
			{
				message: "Upload properties are only allowed in import schemas",
				path: ["fields", "metadata", "properties", "attachments", "items", "format"],
			},
		]);
		expect(validateAppSchemaDefinition(s, { allowUpload: true })).toEqual([]);
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
