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
			label: "Value",
			type: "string",
			validation: { required: true },
		});
		expect(toAppSchema(z.number())).toEqual({
			label: "Value",
			type: "number",
			validation: { required: true },
		});
		expect(toAppSchema(z.number().int())).toEqual({
			label: "Value",
			type: "integer",
			validation: { required: true },
		});
		expect(toAppSchema(z.boolean())).toEqual({
			label: "Value",
			type: "boolean",
			validation: { required: true },
		});
		expect(toAppSchema(z.string().date())).toEqual({
			type: "date",
			label: "Value",
			validation: { required: true },
		});
		expect(toAppSchema(z.iso.datetime())).toEqual({
			label: "Value",
			type: "datetime",
			validation: { required: true },
		});
	});

	it("drops required when wrappers make a field optional", () => {
		expect(toAppSchema(z.string().optional())).toEqual({
			label: "Value",
			type: "string",
		});
		expect(toAppSchema(z.number().nullable())).toEqual({
			label: "Value",
			type: "number",
		});
		expect(toAppSchema(z.boolean().nullish())).toEqual({
			label: "Value",
			type: "boolean",
		});
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
			label: "Value",
			unknownKeys: "strip",
			validation: { required: true },
			properties: {
				author: {
					label: "Author",
					type: "object",
					unknownKeys: "strip",
					validation: { required: true },
					properties: {
						age: { label: "Age", type: "integer" },
						name: {
							label: "Name",
							type: "string",
							validation: { required: true },
						},
					},
				},
			},
		});
	});

	it("does not add required to array item definitions", () => {
		expect(toAppSchema(z.array(z.string()))).toEqual({
			type: "array",
			label: "Value",
			validation: { required: true },
			items: { label: "Item", type: "string" },
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
				title: { label: "Title", type: "string" },
				pages: { label: "Pages", type: "integer" },
			},
		});
	});

	it("preserves object unknown-key policy when converting from zod", () => {
		expect(
			toAppSchema(
				z.object({
					metadata: z.object({ title: z.string() }),
				}),
			),
		).toEqual({
			label: "Value",
			type: "object",
			unknownKeys: "strip",
			validation: { required: true },
			properties: {
				metadata: {
					label: "Metadata",
					type: "object",
					unknownKeys: "strip",
					validation: { required: true },
					properties: {
						title: {
							label: "Title",
							type: "string",
							validation: { required: true },
						},
					},
				},
			},
		});
	});
});

describe("fromAppSchema", () => {
	it("validates primitive schemas", () => {
		expect(
			fromAppSchema({ label: "Value", type: "string" }).safeParse("hello")
				.success,
		).toBeTrue();
		expect(
			fromAppSchema({ label: "Value", type: "integer" }).safeParse(12.5)
				.success,
		).toBeFalse();
		expect(
			fromAppSchema({ label: "Value", type: "date" }).safeParse("2026-03-08")
				.success,
		).toBeTrue();
		expect(
			fromAppSchema({ label: "Value", type: "datetime" }).safeParse(
				"2026-03-08T10:15:30Z",
			).success,
		).toBeTrue();
	});

	it("allows null and undefined for non-required fields", () => {
		expect(
			fromAppSchema({ label: "Value", type: "string" }).safeParse(null).success,
		).toBeTrue();
		expect(
			fromAppSchema({ label: "Value", type: "string" }).safeParse(undefined)
				.success,
		).toBeTrue();
		expect(
			fromAppSchema({ label: "Value", type: "boolean" }).safeParse(null)
				.success,
		).toBeTrue();
		expect(
			fromAppSchema({ label: "Value", type: "boolean" }).safeParse(undefined)
				.success,
		).toBeTrue();
		expect(
			fromAppSchema({ label: "Value", type: "number" }).safeParse(null).success,
		).toBeTrue();
		expect(
			fromAppSchema({ label: "Value", type: "number" }).safeParse(undefined)
				.success,
		).toBeTrue();
		expect(
			fromAppSchema({ label: "Value", type: "integer" }).safeParse(null)
				.success,
		).toBeTrue();
		expect(
			fromAppSchema({ label: "Value", type: "integer" }).safeParse(undefined)
				.success,
		).toBeTrue();
		expect(
			fromAppSchema({ label: "Value", type: "date" }).safeParse(null).success,
		).toBeTrue();
		expect(
			fromAppSchema({ label: "Value", type: "date" }).safeParse(undefined)
				.success,
		).toBeTrue();
		expect(
			fromAppSchema({ label: "Value", type: "datetime" }).safeParse(null)
				.success,
		).toBeTrue();
		expect(
			fromAppSchema({ label: "Value", type: "datetime" }).safeParse(undefined)
				.success,
		).toBeTrue();
		expect(
			fromAppSchema({
				type: "array",
				label: "Value",
				items: { label: "Item", type: "string" },
			}).safeParse(null).success,
		).toBeTrue();
		expect(
			fromAppSchema({
				type: "array",
				label: "Value",
				items: { label: "Item", type: "string" },
			}).safeParse(undefined).success,
		).toBeTrue();
	});

	it("rejects null for required fields", () => {
		expect(
			fromAppSchema({
				label: "Value",
				type: "string",
				validation: { required: true },
			}).safeParse(null).success,
		).toBeFalse();
		expect(
			fromAppSchema({
				label: "Value",
				type: "boolean",
				validation: { required: true },
			}).safeParse(null).success,
		).toBeFalse();
		expect(
			fromAppSchema({
				label: "Value",
				type: "number",
				validation: { required: true },
			}).safeParse(null).success,
		).toBeFalse();
		expect(
			fromAppSchema({
				label: "Value",
				type: "integer",
				validation: { required: true },
			}).safeParse(null).success,
		).toBeFalse();
		expect(
			fromAppSchema({
				type: "array",
				label: "Value",
				items: { label: "Item", type: "string" },
				validation: { required: true },
			}).safeParse(null).success,
		).toBeFalse();
	});

	it("validates nested object required-ness", () => {
		const schema = fromAppSchema({
			type: "object",
			label: "Value",
			properties: {
				author: {
					label: "Author",
					type: "object",
					validation: { required: true },
					properties: {
						age: { label: "Age", type: "integer" },
						name: {
							label: "Name",
							type: "string",
							validation: { required: true },
						},
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

	it("strips unknown keys when an object property opts in", () => {
		const schema = fromAppSchema({
			type: "object",
			label: "Value",
			unknownKeys: "strip",
			properties: {
				author: {
					label: "Author",
					type: "object",
					unknownKeys: "strip",
					validation: { required: true },
					properties: {
						name: {
							label: "Name",
							type: "string",
							validation: { required: true },
						},
					},
				},
			},
		});

		expect(
			schema.parse({
				extra: true,
				author: { name: "Ada", extra: true },
			}),
		).toEqual({ author: { name: "Ada" } });
	});

	it("preserves unknown keys when an object property opts into passthrough", () => {
		const schema = fromAppSchema({
			type: "object",
			label: "Value",
			unknownKeys: "passthrough",
			properties: {
				author: {
					label: "Author",
					type: "object",
					unknownKeys: "passthrough",
					validation: { required: true },
					properties: {
						name: {
							label: "Name",
							type: "string",
							validation: { required: true },
						},
					},
				},
			},
		});

		expect(
			schema.parse({
				extra: true,
				author: { name: "Ada", extra: true },
			}),
		).toEqual({
			extra: true,
			author: { name: "Ada", extra: true },
		});
	});

	it("applies string validation rules", () => {
		const schema = fromAppSchema({
			type: "string",
			label: "Value",
			validation: { minLength: 2, maxLength: 4, pattern: "^[A-Z]+$" },
		});

		expect(schema.safeParse("OK").success).toBeTrue();
		expect(schema.safeParse("O").success).toBeFalse();
		expect(schema.safeParse("TOO_LONG").success).toBeFalse();
		expect(schema.safeParse("bad").success).toBeFalse();
	});

	it("applies numeric validation rules", () => {
		const schema = fromAppSchema({
			label: "Value",
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
			label: "Value",
			transform: { round: { mode: "half_up", scale: 2 } },
			validation: { exclusiveMaximum: 100, exclusiveMinimum: 0 },
		});

		expect(schema.parse(25.555)).toBe(25.56);
		expect(() => schema.parse(99.995)).toThrow();
		expect(() => schema.parse(0.004)).toThrow();
	});

	it("applies array validation rules", () => {
		const schema = fromAppSchema({
			label: "Value",
			type: "array",
			items: { label: "Item", type: "string" },
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
				progressPercent: { label: "Progress Percent", type: "number" },
				status: {
					label: "Status",
					type: "string",
					validation: { required: true },
				},
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
					label: "Metadata",
					properties: {
						score: { label: "Score", type: "integer" },
						status: { label: "Status", type: "string" },
						verified: { label: "Verified", type: "boolean" },
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
			rating: { label: "Rating", type: "integer" as const },
			metadata: {
				label: "Metadata",
				type: "object" as const,
				properties: { title: { label: "Title", type: "string" as const } },
			},
		};

		expect(getAppPropertyDefinitionAtPath(fields, ["rating"])).toEqual({
			type: "integer",
			label: "Rating",
		});
		expect(
			getAppPropertyDefinitionAtPath(fields, ["metadata", "title"]),
		).toEqual({ label: "Title", type: "string" });
		expect(
			getAppPropertyDefinitionAtPath(fields, ["metadata", "missing"]),
		).toBe(undefined);
	});
});

describe("isAppPropertyRequired", () => {
	it("reads required state from validation metadata", () => {
		expect(
			isAppPropertyRequired({ label: "Value", type: "string" }),
		).toBeFalse();
		expect(
			isAppPropertyRequired({
				label: "Value",
				type: "string",
				validation: { required: true },
			}),
		).toBeTrue();
	});
});
