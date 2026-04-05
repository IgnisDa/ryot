import { describe, expect, it } from "bun:test";
import { z } from "zod";
import {
	fromAppSchema,
	fromAppSchemaObject,
	getAppPropertyDefinitionAtPath,
	isAppPropertyRequired,
	toAppSchema,
	toAppSchemaProperties,
} from "./app-schema";

describe("toAppSchema", () => {
	it("marks non-optional primitive fields as required", () => {
		expect(toAppSchema(z.string())).toEqual({
			type: "string",
			validation: { required: true },
		});
		expect(toAppSchema(z.number())).toEqual({
			type: "number",
			validation: { required: true },
		});
		expect(toAppSchema(z.number().int())).toEqual({
			type: "integer",
			validation: { required: true },
		});
		expect(toAppSchema(z.boolean())).toEqual({
			type: "boolean",
			validation: { required: true },
		});
		expect(toAppSchema(z.string().date())).toEqual({
			type: "date",
			validation: { required: true },
		});
		expect(toAppSchema(z.iso.datetime())).toEqual({
			type: "datetime",
			validation: { required: true },
		});
	});

	it("drops required when wrappers make a field optional", () => {
		expect(toAppSchema(z.string().optional())).toEqual({ type: "string" });
		expect(toAppSchema(z.number().nullable())).toEqual({ type: "number" });
		expect(toAppSchema(z.boolean().nullish())).toEqual({ type: "boolean" });
	});

	it("preserves requiredness for nested object properties", () => {
		expect(
			toAppSchema(
				z.object({
					author: z.object({
						name: z.string(),
						age: z.number().int().optional(),
					}),
				}),
			),
		).toEqual({
			type: "object",
			validation: { required: true },
			properties: {
				author: {
					type: "object",
					validation: { required: true },
					properties: {
						age: { type: "integer" },
						name: { type: "string", validation: { required: true } },
					},
				},
			},
		});
	});

	it("does not add required to array item definitions", () => {
		expect(toAppSchema(z.array(z.string()))).toEqual({
			type: "array",
			items: { type: "string" },
			validation: { required: true },
		});
	});
});

describe("toAppSchemaProperties", () => {
	it("unwraps top-level object shapes while keeping requiredness", () => {
		expect(
			toAppSchemaProperties(
				z.object({
					title: z.string(),
					pages: z.number().int().optional(),
				}),
			),
		).toEqual({
			fields: {
				title: { type: "string" },
				pages: { type: "integer" },
			},
		});
	});
});

describe("fromAppSchema", () => {
	it("validates primitive schemas", () => {
		expect(
			fromAppSchema({ type: "string" }).safeParse("hello").success,
		).toBeTrue();
		expect(
			fromAppSchema({ type: "integer" }).safeParse(12.5).success,
		).toBeFalse();
		expect(
			fromAppSchema({ type: "date" }).safeParse("2026-03-08").success,
		).toBeTrue();
		expect(
			fromAppSchema({ type: "datetime" }).safeParse("2026-03-08T10:15:30Z")
				.success,
		).toBeTrue();
	});

	it("allows null and undefined for non-required fields", () => {
		expect(
			fromAppSchema({ type: "string" }).safeParse(null).success,
		).toBeTrue();
		expect(
			fromAppSchema({ type: "string" }).safeParse(undefined).success,
		).toBeTrue();
		expect(
			fromAppSchema({ type: "boolean" }).safeParse(null).success,
		).toBeTrue();
		expect(
			fromAppSchema({ type: "boolean" }).safeParse(undefined).success,
		).toBeTrue();
		expect(
			fromAppSchema({ type: "number" }).safeParse(null).success,
		).toBeTrue();
		expect(
			fromAppSchema({ type: "number" }).safeParse(undefined).success,
		).toBeTrue();
		expect(
			fromAppSchema({ type: "integer" }).safeParse(null).success,
		).toBeTrue();
		expect(
			fromAppSchema({ type: "integer" }).safeParse(undefined).success,
		).toBeTrue();
		expect(fromAppSchema({ type: "date" }).safeParse(null).success).toBeTrue();
		expect(
			fromAppSchema({ type: "date" }).safeParse(undefined).success,
		).toBeTrue();
		expect(
			fromAppSchema({ type: "datetime" }).safeParse(null).success,
		).toBeTrue();
		expect(
			fromAppSchema({ type: "datetime" }).safeParse(undefined).success,
		).toBeTrue();
		expect(
			fromAppSchema({ type: "array", items: { type: "string" } }).safeParse(
				null,
			).success,
		).toBeTrue();
		expect(
			fromAppSchema({ type: "array", items: { type: "string" } }).safeParse(
				undefined,
			).success,
		).toBeTrue();
	});

	it("rejects null for required fields", () => {
		expect(
			fromAppSchema({
				type: "string",
				validation: { required: true },
			}).safeParse(null).success,
		).toBeFalse();
		expect(
			fromAppSchema({
				type: "boolean",
				validation: { required: true },
			}).safeParse(null).success,
		).toBeFalse();
		expect(
			fromAppSchema({
				type: "number",
				validation: { required: true },
			}).safeParse(null).success,
		).toBeFalse();
		expect(
			fromAppSchema({
				type: "integer",
				validation: { required: true },
			}).safeParse(null).success,
		).toBeFalse();
		expect(
			fromAppSchema({
				type: "array",
				items: { type: "string" },
				validation: { required: true },
			}).safeParse(null).success,
		).toBeFalse();
	});

	it("validates nested object required-ness", () => {
		const schema = fromAppSchema({
			type: "object",
			properties: {
				author: {
					type: "object",
					validation: { required: true },
					properties: {
						age: { type: "integer" },
						name: { type: "string", validation: { required: true } },
					},
				},
			},
		});

		expect(schema.safeParse({ author: { name: "Ada" } }).success).toBeTrue();
		expect(schema.safeParse({ author: {} }).success).toBeFalse();
		expect(
			schema.safeParse({ author: { name: "Ada", extra: true } }).success,
		).toBeFalse();
	});

	it("applies string validation rules", () => {
		const schema = fromAppSchema({
			type: "string",
			validation: { minLength: 2, maxLength: 4, pattern: "^[A-Z]+$" },
		});

		expect(schema.safeParse("OK").success).toBeTrue();
		expect(schema.safeParse("O").success).toBeFalse();
		expect(schema.safeParse("TOO_LONG").success).toBeFalse();
		expect(schema.safeParse("bad").success).toBeFalse();
	});

	it("applies numeric validation rules", () => {
		const schema = fromAppSchema({
			type: "integer",
			validation: { minimum: 1, maximum: 5 },
		});

		expect(schema.safeParse(3).success).toBeTrue();
		expect(schema.safeParse(0).success).toBeFalse();
		expect(schema.safeParse(6).success).toBeFalse();
		expect(schema.safeParse(3.5).success).toBeFalse();
	});

	it("applies transforms before numeric validation", () => {
		const schema = fromAppSchema({
			type: "number",
			transform: { round: { mode: "half_up", scale: 2 } },
			validation: { exclusiveMaximum: 100, exclusiveMinimum: 0 },
		});

		expect(schema.parse(25.555)).toBe(25.56);
		expect(() => schema.parse(99.995)).toThrow();
		expect(() => schema.parse(0.004)).toThrow();
	});

	it("applies array validation rules", () => {
		const schema = fromAppSchema({
			type: "array",
			items: { type: "string" },
			validation: { minItems: 1, maxItems: 2 },
		});

		expect(schema.safeParse(["one"]).success).toBeTrue();
		expect(schema.safeParse([]).success).toBeFalse();
		expect(schema.safeParse(["one", "two", "three"]).success).toBeFalse();
	});
});

describe("fromAppSchemaObject", () => {
	it("applies conditional required rules", () => {
		const schema = fromAppSchemaObject({
			fields: {
				progressPercent: { type: "number" },
				status: { type: "string", validation: { required: true } },
			},
			rules: [
				{
					kind: "validation",
					path: ["progressPercent"],
					validation: { required: true },
					when: { operator: "eq", path: ["status"], value: "completed" },
				},
			],
		});

		expect(schema.safeParse({ status: "in_progress" }).success).toBeTrue();
		expect(schema.safeParse({ status: "completed" }).success).toBeFalse();
		expect(
			schema.safeParse({ status: "completed", progressPercent: 82 }).success,
		).toBeTrue();
	});

	it("supports nested all and any rule conditions", () => {
		const schema = fromAppSchemaObject({
			fields: {
				metadata: {
					type: "object",
					properties: {
						score: { type: "integer" },
						status: { type: "string" },
						verified: { type: "boolean" },
					},
				},
			},
			rules: [
				{
					kind: "validation",
					path: ["metadata", "score"],
					validation: { required: true },
					when: {
						operator: "all",
						conditions: [
							{
								operator: "in",
								path: ["metadata", "status"],
								value: ["published", "archived"],
							},
							{
								operator: "any",
								conditions: [
									{
										value: true,
										operator: "eq",
										path: ["metadata", "verified"],
									},
									{
										value: "archived",
										operator: "eq",
										path: ["metadata", "status"],
									},
								],
							},
						],
					},
				},
			],
		});

		expect(
			schema.safeParse({ metadata: { status: "draft", verified: true } })
				.success,
		).toBeTrue();
		expect(
			schema.safeParse({ metadata: { status: "published", verified: false } })
				.success,
		).toBeTrue();
		expect(
			schema.safeParse({ metadata: { status: "published", verified: true } })
				.success,
		).toBeFalse();
		expect(
			schema.safeParse({
				metadata: { score: 9, status: "published", verified: true },
			}).success,
		).toBeTrue();
	});
});

describe("getAppPropertyDefinitionAtPath", () => {
	it("resolves top-level and nested object properties", () => {
		const fields = {
			rating: { type: "integer" as const },
			metadata: {
				type: "object" as const,
				properties: { title: { type: "string" as const } },
			},
		};

		expect(getAppPropertyDefinitionAtPath(fields, ["rating"])).toEqual({
			type: "integer",
		});
		expect(
			getAppPropertyDefinitionAtPath(fields, ["metadata", "title"]),
		).toEqual({ type: "string" });
		expect(
			getAppPropertyDefinitionAtPath(fields, ["metadata", "missing"]),
		).toBe(undefined);
	});
});

describe("isAppPropertyRequired", () => {
	it("reads required state from validation metadata", () => {
		expect(isAppPropertyRequired({ type: "string" })).toBeFalse();
		expect(
			isAppPropertyRequired({
				type: "string",
				validation: { required: true },
			}),
		).toBeTrue();
	});
});
