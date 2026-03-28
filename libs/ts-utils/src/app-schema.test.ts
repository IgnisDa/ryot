import { describe, expect, it } from "bun:test";

import { z } from "zod";

import {
	fromAppSchema,
	fromAppSchemaObject,
	getAppPropertyDefinitionAtPath,
	getDefaultPropertyLabel,
	isAppPropertyRequired,
	toAppSchema,
	toAppSchemaProperties,
} from "./app-schema";

describe("toAppSchema", () => {
	it("marks non-optional primitive fields as required", () => {
		expect(toAppSchema(z.string())).toEqual({
			label: "Value",
			description: "Value",
			type: "string",
			validation: { required: true },
		});
		expect(toAppSchema(z.number())).toEqual({
			label: "Value",
			description: "Value",
			type: "number",
			validation: { required: true },
		});
		expect(toAppSchema(z.number().int())).toEqual({
			label: "Value",
			description: "Value",
			type: "integer",
			validation: { required: true },
		});
		expect(toAppSchema(z.boolean())).toEqual({
			label: "Value",
			description: "Value",
			type: "boolean",
			validation: { required: true },
		});
		expect(toAppSchema(z.iso.date())).toEqual({
			type: "date",
			label: "Value",
			description: "Value",
			validation: { required: true },
		});
		expect(toAppSchema(z.iso.datetime())).toEqual({
			label: "Value",
			description: "Value",
			type: "datetime",
			validation: { required: true },
		});
	});

	it("drops required when wrappers make a field optional", () => {
		expect(toAppSchema(z.string().optional())).toEqual({
			label: "Value",
			description: "Value",
			type: "string",
		});
		expect(toAppSchema(z.number().nullable())).toEqual({
			label: "Value",
			description: "Value",
			type: "number",
		});
		expect(toAppSchema(z.boolean().nullish())).toEqual({
			label: "Value",
			description: "Value",
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
			description: "Value",
			unknownKeys: "strip",
			validation: { required: true },
			properties: {
				author: {
					label: "Author",
					description: "Author",
					type: "object",
					unknownKeys: "strip",
					validation: { required: true },
					properties: {
						age: {
							label: "Age",
							description: "Age",
							type: "integer",
						},
						name: {
							label: "Name",
							description: "Name",
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
			description: "Value",
			validation: { required: true },
			items: { label: "Item", description: "Item", type: "string" },
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
				title: {
					label: "Title",
					description: "Title",
					type: "string",
				},
				pages: {
					label: "Pages",
					description: "Pages",
					type: "integer",
				},
			},
		});
	});

	it("serializes discriminated unions inside object fields", () => {
		expect(
			toAppSchemaProperties(
				z.object({
					images: z.array(
						z.discriminatedUnion("kind", [
							z.object({ kind: z.literal("remote"), url: z.string() }),
							z.object({ kind: z.literal("s3"), key: z.string() }),
						]),
					),
				}),
			),
		).toEqual({
			fields: {
				images: {
					label: "Images",
					description: "Images",
					type: "array",
					items: {
						label: "Item",
						description: "Item",
						type: "object",
						unknownKeys: "strip",
						properties: {
							key: {
								label: "Key",
								description: "Key",
								type: "string",
							},
							kind: {
								label: "Kind",
								description: "Kind",
								type: "enum",
								options: ["remote", "s3"],
								validation: { required: true },
							},
							url: {
								label: "Url",
								description: "Url",
								type: "string",
							},
						},
					},
				},
			},
		});
	});
});

describe("fromAppSchema", () => {
	it("validates nested object required-ness", () => {
		const schema = fromAppSchema({
			type: "object",
			label: "Value",
			description: "Value",
			properties: {
				author: {
					label: "Author",
					description: "Author",
					type: "object",
					validation: { required: true },
					properties: {
						age: {
							label: "Age",
							description: "Age",
							type: "integer",
						},
						name: {
							label: "Name",
							description: "Name",
							type: "string",
							validation: { required: true },
						},
					},
				},
			},
		});

		expect(schema.safeParse({ author: { name: "Ada" } }).success).toBeTrue();
		expect(schema.safeParse({ author: {} }).success).toBeFalse();
		expect(schema.safeParse({ author: { name: "Ada", extra: true } }).success).toBeFalse();
	});

	it("strips unknown keys when an object property opts in", () => {
		const schema = fromAppSchema({
			type: "object",
			label: "Value",
			description: "Value",
			unknownKeys: "strip",
			properties: {
				author: {
					label: "Author",
					description: "Author",
					type: "object",
					unknownKeys: "strip",
					validation: { required: true },
					properties: {
						name: {
							label: "Name",
							description: "Name",
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
			description: "Value",
			unknownKeys: "passthrough",
			properties: {
				author: {
					label: "Author",
					description: "Author",
					type: "object",
					unknownKeys: "passthrough",
					validation: { required: true },
					properties: {
						name: {
							label: "Name",
							description: "Name",
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

	it("applies transforms before numeric validation", () => {
		const schema = fromAppSchema({
			type: "number",
			label: "Value",
			description: "Value",
			transform: { round: { mode: "half_up", scale: 2 } },
			validation: { exclusiveMaximum: 100, exclusiveMinimum: 0 },
		});

		expect(schema.parse(25.555)).toBe(25.56);
		expect(() => schema.parse(99.995)).toThrow();
		expect(() => schema.parse(0.004)).toThrow();
	});

	it("accepts a valid enum value and rejects values outside the options", () => {
		const schema = fromAppSchema({
			type: "enum",
			label: "Status",
			description: "Status",
			options: ["draft", "published", "archived"],
		});

		expect(schema.safeParse("draft").success).toBeTrue();
		expect(schema.safeParse("published").success).toBeTrue();
		expect(schema.safeParse("unknown").success).toBeFalse();
		expect(schema.safeParse(null).success).toBeTrue();
	});

	it("treats a required enum as non-nullable", () => {
		const schema = fromAppSchema({
			type: "enum",
			label: "Status",
			description: "Status",
			validation: { required: true },
			options: ["active", "inactive"],
		});

		expect(schema.safeParse("active").success).toBeTrue();
		expect(schema.safeParse(null).success).toBeFalse();
		expect(schema.safeParse(undefined).success).toBeFalse();
	});

	it("accepts valid enum-array values and rejects items outside options", () => {
		const schema = fromAppSchema({
			label: "Genres",
			description: "Genres",
			type: "enum-array",
			options: ["fiction", "non-fiction", "mystery"],
		});

		expect(schema.safeParse(["fiction", "mystery"]).success).toBeTrue();
		expect(schema.safeParse([]).success).toBeTrue();
		expect(schema.safeParse(["fiction", "invalid"]).success).toBeFalse();
	});

	it("applies minItems/maxItems validation to enum-array", () => {
		const schema = fromAppSchema({
			label: "Tags",
			description: "Tags",
			type: "enum-array",
			options: ["a", "b", "c"],
			validation: { minItems: 1, maxItems: 2 },
		});

		expect(schema.safeParse([]).success).toBeFalse();
		expect(schema.safeParse(["a"]).success).toBeTrue();
		expect(schema.safeParse(["a", "b", "c"]).success).toBeFalse();
	});

	it("uses defaultValue when field is absent for a non-required string", () => {
		const schema = fromAppSchema({
			label: "Note",
			type: "string",
			description: "Note",
			defaultValue: "no note",
		});

		expect(schema.parse(undefined)).toBe("no note");
		expect(schema.parse("custom")).toBe("custom");
		expect(schema.parse(null)).toBeNull();
	});

	it("uses defaultValue for a required field and still rejects null", () => {
		const schema = fromAppSchema({
			type: "string",
			label: "Status",
			description: "Status",
			defaultValue: "active",
			validation: { required: true },
		});

		expect(schema.parse(undefined)).toBe("active");
		expect(schema.parse("inactive")).toBe("inactive");
		expect(schema.safeParse(null).success).toBeFalse();
	});

	it("uses defaultValue for number, boolean, enum, enum-array, array, and object types", () => {
		expect(
			fromAppSchema({ type: "number", label: "x", description: "x", defaultValue: 3.14 }).parse(
				undefined,
			),
		).toBe(3.14);

		expect(
			fromAppSchema({ type: "integer", label: "x", description: "x", defaultValue: 7 }).parse(
				undefined,
			),
		).toBe(7);

		expect(
			fromAppSchema({
				label: "x",
				type: "boolean",
				description: "x",
				defaultValue: false,
			}).parse(undefined),
		).toBe(false);

		expect(
			fromAppSchema({
				label: "x",
				type: "enum",
				description: "x",
				defaultValue: "b",
				options: ["a", "b"],
			}).parse(undefined),
		).toBe("b");

		expect(
			fromAppSchema({
				label: "x",
				description: "x",
				type: "enum-array",
				options: ["a", "b"],
				defaultValue: ["a"],
			}).parse(undefined),
		).toEqual(["a"]);

		expect(
			fromAppSchema({
				label: "x",
				type: "array",
				description: "x",
				defaultValue: [],
				items: { type: "string", label: "item", description: "item" },
			}).parse(undefined),
		).toEqual([]);

		expect(
			fromAppSchema({
				label: "x",
				type: "object",
				description: "x",
				defaultValue: { color: "red" },
				properties: { color: { type: "string", label: "Color", description: "Color" } },
			}).parse(undefined),
		).toEqual({ color: "red" });
	});
});

describe("fromAppSchemaObject", () => {
	it("accepts null for non-required object fields", () => {
		const schema = fromAppSchemaObject({
			fields: {
				timeToBeat: {
					type: "object",
					label: "Time To Beat",
					description: "Time To Beat",
					properties: {
						hastily: { type: "integer", label: "Hastily", description: "Hastily" },
						normally: { type: "integer", label: "Normally", description: "Normally" },
						completely: { type: "integer", label: "Completely", description: "Completely" },
					},
				},
			},
		});

		expect(schema.safeParse({ timeToBeat: null }).success).toBeTrue();
		expect(schema.safeParse({ timeToBeat: undefined }).success).toBeTrue();
		expect(
			schema.safeParse({
				timeToBeat: { hastily: 5, normally: 10, completely: 20 },
			}).success,
		).toBeTrue();
	});

	it("applies conditional required rules", () => {
		const schema = fromAppSchemaObject({
			fields: {
				progressPercent: {
					type: "number",
					label: "Progress Percent",
					description: "Progress Percent",
				},
				status: {
					type: "string",
					label: "Status",
					description: "Status",
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
		expect(schema.safeParse({ status: "completed", progressPercent: 82 }).success).toBeTrue();
	});

	it("applies defaultValue for a top-level field when the key is absent", () => {
		const schema = fromAppSchemaObject({
			fields: {
				note: { label: "Note", type: "string", description: "Note" },
				rating: { type: "integer", label: "Rating", defaultValue: 5, description: "Rating" },
			},
		});

		expect(schema.parse({})).toEqual({ rating: 5 });
		expect(schema.parse({ rating: 3 })).toEqual({ rating: 3 });
		expect(schema.parse({ rating: 3, note: "great" })).toEqual({ rating: 3, note: "great" });
	});

	it("applies defaultValue for nested object properties", () => {
		const schema = fromAppSchemaObject({
			fields: {
				meta: {
					label: "Meta",
					type: "object",
					description: "Meta",
					properties: {
						source: {
							type: "string",
							label: "Source",
							description: "Source",
							defaultValue: "manual",
						},
					},
				},
			},
		});

		expect(schema.parse({ meta: {} })).toEqual({ meta: { source: "manual" } });
		expect(schema.parse({ meta: { source: "import" } })).toEqual({
			meta: { source: "import" },
		});
	});

	it("supports nested all and any rule conditions", () => {
		const schema = fromAppSchemaObject({
			fields: {
				metadata: {
					type: "object",
					label: "Metadata",
					description: "Metadata",
					properties: {
						score: { label: "Score", type: "integer", description: "Score" },
						status: { type: "string", label: "Status", description: "Status" },
						verified: { type: "boolean", label: "Verified", description: "Verified" },
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
							{ operator: "in", path: ["metadata", "status"], value: ["published", "archived"] },
							{
								operator: "any",
								conditions: [
									{ value: true, operator: "eq", path: ["metadata", "verified"] },
									{ value: "archived", operator: "eq", path: ["metadata", "status"] },
								],
							},
						],
					},
				},
			],
		});

		expect(schema.safeParse({ metadata: { status: "draft", verified: true } }).success).toBeTrue();
		expect(
			schema.safeParse({ metadata: { status: "published", verified: false } }).success,
		).toBeTrue();
		expect(
			schema.safeParse({ metadata: { status: "published", verified: true } }).success,
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
			rating: { label: "Rating", description: "Rating", type: "integer" as const },
			metadata: {
				label: "Metadata",
				description: "Metadata",
				type: "object" as const,
				properties: {
					title: { label: "Title", description: "Title", type: "string" as const },
				},
			},
		};

		expect(getAppPropertyDefinitionAtPath(fields, ["rating"])).toEqual({
			type: "integer",
			label: "Rating",
			description: "Rating",
		});
		expect(getAppPropertyDefinitionAtPath(fields, ["metadata", "title"])).toEqual({
			type: "string",
			label: "Title",
			description: "Title",
		});
		expect(getAppPropertyDefinitionAtPath(fields, ["metadata", "missing"])).toBe(undefined);
	});
});

describe("isAppPropertyRequired", () => {
	it("reads required state from validation metadata", () => {
		expect(
			isAppPropertyRequired({ type: "string", label: "Value", description: "Value" }),
		).toBeFalse();
		expect(
			isAppPropertyRequired({
				type: "string",
				label: "Value",
				description: "Value",
				validation: { required: true },
			}),
		).toBeTrue();
	});
});

describe("getDefaultPropertyLabel", () => {
	it("converts camelCase keys to readable labels", () => {
		expect(getDefaultPropertyLabel("myPropertyName")).toBe("My Property Name");
		expect(getDefaultPropertyLabel("firstName")).toBe("First Name");
		expect(getDefaultPropertyLabel("isbnNumber")).toBe("Isbn Number");
	});

	it("converts snake_case keys to readable labels", () => {
		expect(getDefaultPropertyLabel("my_property_name")).toBe("My Property Name");
		expect(getDefaultPropertyLabel("first_name")).toBe("First Name");
	});

	it("converts kebab-case keys to readable labels", () => {
		expect(getDefaultPropertyLabel("my-property-name")).toBe("My Property Name");
		expect(getDefaultPropertyLabel("first-name")).toBe("First Name");
	});

	it("handles mixed case styles", () => {
		expect(getDefaultPropertyLabel("my_Property-name")).toBe("My Property Name");
		expect(getDefaultPropertyLabel("myProperty_name")).toBe("My Property Name");
	});

	it("capitalizes single words", () => {
		expect(getDefaultPropertyLabel("name")).toBe("Name");
		expect(getDefaultPropertyLabel("title")).toBe("Title");
	});

	it("handles empty and whitespace-only strings", () => {
		expect(getDefaultPropertyLabel("")).toBe("");
		expect(getDefaultPropertyLabel("   ")).toBe("");
	});

	it("normalizes multiple consecutive separators", () => {
		expect(getDefaultPropertyLabel("my__property")).toBe("My Property");
		expect(getDefaultPropertyLabel("my--property")).toBe("My Property");
		expect(getDefaultPropertyLabel("my  property")).toBe("My Property");
	});
});
