import { describe, expect, it } from "bun:test";
import { z } from "zod";
import {
	fromAppSchema,
	toAppSchema,
	toAppSchemaProperties,
} from "./app-schema";

describe("toAppSchema", () => {
	describe("primitive types", () => {
		it("converts z.string() to string type", () => {
			expect(toAppSchema(z.string())).toEqual({ type: "string" });
		});

		it("converts z.number() to number type", () => {
			expect(toAppSchema(z.number())).toEqual({ type: "number" });
		});

		it("converts z.number().int() to integer type", () => {
			expect(toAppSchema(z.number().int())).toEqual({ type: "integer" });
		});

		it("converts z.boolean() to boolean type", () => {
			expect(toAppSchema(z.boolean())).toEqual({ type: "boolean" });
		});

		it("converts z.string().date() to date type", () => {
			expect(toAppSchema(z.string().date())).toEqual({ type: "date" });
		});

		it("converts z.iso.datetime() to date type", () => {
			expect(toAppSchema(z.iso.datetime())).toEqual({ type: "date" });
		});
	});

	describe("nullable modifier", () => {
		it("adds nullable: true for nullish()", () => {
			expect(toAppSchema(z.string().nullish())).toEqual({
				type: "string",
				nullable: true,
			});
		});

		it("adds nullable: true for nullable()", () => {
			expect(toAppSchema(z.number().nullable())).toEqual({
				type: "number",
				nullable: true,
			});
		});

		it("adds nullable: true for optional()", () => {
			expect(toAppSchema(z.boolean().optional())).toEqual({
				type: "boolean",
				nullable: true,
			});
		});

		it("preserves integer type with nullish", () => {
			expect(toAppSchema(z.number().int().nullish())).toEqual({
				type: "integer",
				nullable: true,
			});
		});

		it("handles nested nullable wrappers", () => {
			expect(toAppSchema(z.string().nullable().optional())).toEqual({
				type: "string",
				nullable: true,
			});
		});

		it("preserves date type with nullable", () => {
			expect(toAppSchema(z.string().date().nullable())).toEqual({
				type: "date",
				nullable: true,
			});
		});
	});

	describe("array types", () => {
		it("converts z.array(z.string()) to array of strings", () => {
			expect(toAppSchema(z.array(z.string()))).toEqual({
				type: "array",
				items: { type: "string" },
			});
		});

		it("converts nested array items correctly", () => {
			expect(toAppSchema(z.array(z.number().int()))).toEqual({
				type: "array",
				items: { type: "integer" },
			});
		});

		it("handles nullable array items", () => {
			expect(toAppSchema(z.array(z.string().nullish()))).toEqual({
				type: "array",
				items: { type: "string", nullable: true },
			});
		});
	});

	describe("object types", () => {
		it("converts z.object() with properties", () => {
			expect(
				toAppSchema(
					z.object({
						title: z.string(),
						pages: z.number().int(),
					}),
				),
			).toEqual({
				type: "object",
				properties: {
					title: { type: "string" },
					pages: { type: "integer" },
				},
			});
		});

		it("handles nested objects", () => {
			expect(
				toAppSchema(
					z.object({
						author: z.object({
							name: z.string(),
							age: z.number().int(),
						}),
					}),
				),
			).toEqual({
				type: "object",
				properties: {
					author: {
						type: "object",
						properties: {
							name: { type: "string" },
							age: { type: "integer" },
						},
					},
				},
			});
		});

		it("handles arrays of objects", () => {
			expect(
				toAppSchema(
					z.array(
						z.object({
							role: z.string(),
							identifier: z.string(),
						}),
					),
				),
			).toEqual({
				type: "array",
				items: {
					type: "object",
					properties: {
						role: { type: "string" },
						identifier: { type: "string" },
					},
				},
			});
		});
	});

	describe("nullable complex types", () => {
		it("handles nullable arrays", () => {
			expect(toAppSchema(z.array(z.string()).nullable())).toEqual({
				type: "array",
				nullable: true,
				items: { type: "string" },
			});
		});

		it("handles nullable objects", () => {
			expect(toAppSchema(z.object({ title: z.string() }).nullable())).toEqual({
				type: "object",
				nullable: true,
				properties: { title: { type: "string" } },
			});
		});
	});

	describe("error handling", () => {
		it("throws error for unsupported Zod types", () => {
			expect(() => toAppSchema(z.literal("test"))).toThrow(
				"Unsupported Zod type:",
			);
		});
	});
});

describe("toAppSchemaProperties", () => {
	describe("top-level object unwrapping", () => {
		it("unwraps top-level z.object() to flat properties map", () => {
			const schema = z.object({
				title: z.string(),
				pages: z.number().int().nullish(),
			});

			expect(toAppSchemaProperties(schema)).toEqual({
				title: { type: "string" },
				pages: { type: "integer", nullable: true },
			});
		});

		it("keeps nested objects wrapped", () => {
			const schema = z.object({
				author: z.object({ name: z.string() }),
			});

			expect(toAppSchemaProperties(schema)).toEqual({
				author: {
					type: "object",
					properties: { name: { type: "string" } },
				},
			});
		});
	});
});

describe("fromAppSchema", () => {
	describe("primitive types", () => {
		it("converts string type to z.string()", () => {
			const schema = fromAppSchema({ type: "string" });
			expect(schema.safeParse("hello").success).toBeTrue();
			expect(schema.safeParse(123).success).toBeFalse();
		});

		it("converts number type to z.number()", () => {
			const schema = fromAppSchema({ type: "number" });
			expect(schema.safeParse(123.45).success).toBeTrue();
			expect(schema.safeParse("hello").success).toBeFalse();
		});

		it("converts integer type to z.number().int()", () => {
			const schema = fromAppSchema({ type: "integer" });
			expect(schema.safeParse(123).success).toBeTrue();
			expect(schema.safeParse(123.45).success).toBeFalse();
		});

		it("converts boolean type to z.boolean()", () => {
			const schema = fromAppSchema({ type: "boolean" });
			expect(schema.safeParse(true).success).toBeTrue();
			expect(schema.safeParse("true").success).toBeFalse();
		});

		it("converts date type to z.string().date()", () => {
			const schema = fromAppSchema({ type: "date" });
			expect(schema.safeParse("2026-03-08").success).toBeTrue();
			expect(schema.safeParse("not-a-date").success).toBeFalse();
		});
	});

	describe("nullable modifier", () => {
		it("applies nullish() for nullable: true", () => {
			const schema = fromAppSchema({ type: "string", nullable: true });
			expect(schema.safeParse(null).success).toBeTrue();
			expect(schema.safeParse(undefined).success).toBeTrue();
			expect(schema.safeParse("hello").success).toBeTrue();
		});

		it("preserves integer type with nullable", () => {
			const schema = fromAppSchema({ type: "integer", nullable: true });
			expect(schema.safeParse(123).success).toBeTrue();
			expect(schema.safeParse(null).success).toBeTrue();
			expect(schema.safeParse(123.45).success).toBeFalse();
		});
	});

	describe("array types", () => {
		it("converts array of strings", () => {
			const schema = fromAppSchema({
				type: "array",
				items: { type: "string" },
			});
			expect(schema.safeParse(["a", "b", "c"]).success).toBeTrue();
			expect(schema.safeParse([1, 2, 3]).success).toBeFalse();
		});

		it("converts array of integers", () => {
			const schema = fromAppSchema({
				type: "array",
				items: { type: "integer" },
			});
			expect(schema.safeParse([1, 2, 3]).success).toBeTrue();
			expect(schema.safeParse([1.5, 2.5]).success).toBeFalse();
		});

		it("converts array with nullable items", () => {
			const schema = fromAppSchema({
				type: "array",
				items: { type: "string", nullable: true },
			});
			expect(schema.safeParse(["a", null, "c"]).success).toBeTrue();
		});
	});

	describe("object types", () => {
		it("converts simple objects", () => {
			const schema = fromAppSchema({
				type: "object",
				properties: {
					title: { type: "string" },
					pages: { type: "integer" },
				},
			});
			expect(
				schema.safeParse({ title: "Book", pages: 200 }).success,
			).toBeTrue();
			expect(schema.safeParse({ title: "Book" }).success).toBeFalse();
		});

		it("converts nested objects", () => {
			const schema = fromAppSchema({
				type: "object",
				properties: {
					author: {
						type: "object",
						properties: { name: { type: "string" } },
					},
				},
			});
			expect(schema.safeParse({ author: { name: "John" } }).success).toBeTrue();
		});

		it("converts arrays of objects", () => {
			const schema = fromAppSchema({
				type: "array",
				items: {
					type: "object",
					properties: {
						role: { type: "string" },
						identifier: { type: "string" },
					},
				},
			});
			expect(
				schema.safeParse([
					{ role: "author", identifier: "123" },
					{ role: "editor", identifier: "456" },
				]).success,
			).toBeTrue();
		});
	});
});

describe("round-trip conversions", () => {
	it("converts book schema Zod -> App -> Zod", () => {
		const originalSchema = z.object({
			title: z.string(),
			pages: z.number().int().nullish(),
			isCompilation: z.boolean().nullish(),
		});

		const appSchema = toAppSchemaProperties(originalSchema);
		const recreatedZodSchema = z.object(
			Object.fromEntries(
				Object.entries(appSchema).map(([key, value]) => [
					key,
					fromAppSchema(value),
				]),
			),
		);

		const testData = { pages: 300, title: "My Book", isCompilation: false };

		expect(originalSchema.safeParse(testData).success).toBeTrue();
		expect(recreatedZodSchema.safeParse(testData).success).toBeTrue();
	});

	it("handles complex nested structures", () => {
		const originalSchema = z.object({
			people: z.array(
				z.object({
					role: z.string(),
					identifier: z.string(),
				}),
			),
		});

		const appSchema = toAppSchemaProperties(originalSchema);
		const recreatedZodSchema = z.object(
			Object.fromEntries(
				Object.entries(appSchema).map(([key, value]) => [
					key,
					fromAppSchema(value),
				]),
			),
		);

		const testData = {
			people: [
				{ role: "author", identifier: "123" },
				{ role: "editor", identifier: "456" },
			],
		};

		expect(originalSchema.safeParse(testData).success).toBeTrue();
		expect(recreatedZodSchema.safeParse(testData).success).toBeTrue();
	});

	it("handles nullable nested properties", () => {
		const originalSchema = z.object({
			metadata: z
				.object({
					source: z.string(),
					verified: z.boolean().nullish(),
				})
				.nullish(),
		});

		const appSchema = toAppSchemaProperties(originalSchema);
		const recreatedZodSchema = z.object(
			Object.fromEntries(
				Object.entries(appSchema).map(([key, value]) => [
					key,
					fromAppSchema(value),
				]),
			),
		);

		const testData1 = { metadata: { source: "api", verified: true } };
		const testData2 = { metadata: null };

		expect(originalSchema.safeParse(testData1).success).toBeTrue();
		expect(recreatedZodSchema.safeParse(testData1).success).toBeTrue();
		expect(originalSchema.safeParse(testData2).success).toBeTrue();
		expect(recreatedZodSchema.safeParse(testData2).success).toBeTrue();
	});
});
