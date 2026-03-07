# Custom App Schema Format Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Zod's verbose JSON Schema format with a simplified custom app schema format for entity property definitions throughout Ryot.

**Architecture:** Create bidirectional converters between Zod schemas and app schemas in `@ryot/ts-utils` shared library. Update backend to use `toAppSchema()` instead of `toStableJsonSchema()`. Update frontend property builder to produce app schema format. Update validation to accept flat properties map instead of requiring `type: "object"` wrapper.

**Tech Stack:** TypeScript, Zod 4.3.6, Bun test runner

---

## Task 1: Create App Schema Types & Converter Foundation

**Files:**
- Create: `libs/ts-utils/src/app-schema.ts`
- Modify: `libs/ts-utils/src/index.ts`
- Create: `libs/ts-utils/src/app-schema.test.ts`

**Step 1: Write failing test for primitive type conversions**

```typescript
import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { toAppSchema } from "./app-schema";

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
	});
});
```

**Step 2: Run test to verify it fails**

Run: `cd libs/ts-utils && bun test src/app-schema.test.ts`
Expected: FAIL with "Cannot find module './app-schema'"

**Step 3: Create TypeScript types for app schema**

Create file `libs/ts-utils/src/app-schema.ts`:

```typescript
export type AppSchema = Record<string, AppPropertyDefinition>;

export type AppPropertyDefinition =
	| AppPrimitiveProperty
	| AppArrayProperty
	| AppObjectProperty;

export type AppPrimitiveProperty = {
	type: "string" | "number" | "integer" | "boolean" | "date";
	nullable?: true;
	required?: true;
};

export type AppArrayProperty = {
	type: "array";
	items: AppPropertyDefinition;
	nullable?: true;
	required?: true;
};

export type AppObjectProperty = {
	type: "object";
	properties: Record<string, AppPropertyDefinition>;
	nullable?: true;
	required?: true;
};
```

**Step 4: Implement minimal toAppSchema for primitives**

Add to `libs/ts-utils/src/app-schema.ts`:

```typescript
import { z } from "zod";

export const toAppSchema = (schema: z.ZodType): AppPropertyDefinition => {
	const typeName = schema._def.typeName;

	switch (typeName) {
		case "ZodString": {
			const stringSchema = schema as z.ZodString;
			if (stringSchema._def.checks?.some((c) => c.kind === "date")) {
				return { type: "date" };
			}
			return { type: "string" };
		}
		case "ZodNumber": {
			const numberSchema = schema as z.ZodNumber;
			if (numberSchema._def.checks?.some((c) => c.kind === "int")) {
				return { type: "integer" };
			}
			return { type: "number" };
		}
		case "ZodBoolean":
			return { type: "boolean" };
		default:
			throw new Error(`Unsupported Zod type: ${typeName}`);
	}
};
```

**Step 5: Run test to verify primitives pass**

Run: `cd libs/ts-utils && bun test src/app-schema.test.ts`
Expected: PASS - all 5 primitive type tests pass

**Step 6: Commit primitive types**

```bash
git add 'libs/ts-utils/src/app-schema.ts' 'libs/ts-utils/src/app-schema.test.ts'
git commit -m "feat: add app schema types and primitive conversion

- Define AppSchema, AppPropertyDefinition types
- Implement toAppSchema for string, number, integer, boolean, date
- Add test coverage for primitive type conversions

Attribution: OpenCode | Model: Claude Sonnet 4.5"
```

---

## Task 2: Add Nullable Support to toAppSchema

**Files:**
- Modify: `libs/ts-utils/src/app-schema.ts`
- Modify: `libs/ts-utils/src/app-schema.test.ts`

**Step 1: Write failing test for nullable types**

Add to `libs/ts-utils/src/app-schema.test.ts`:

```typescript
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
});
```

**Step 2: Run test to verify it fails**

Run: `cd libs/ts-utils && bun test src/app-schema.test.ts`
Expected: FAIL - nullable tests fail, missing nullable handling

**Step 3: Implement nullable unwrapping**

Update `toAppSchema` in `libs/ts-utils/src/app-schema.ts`:

```typescript
export const toAppSchema = (schema: z.ZodType): AppPropertyDefinition => {
	const typeName = schema._def.typeName;

	// Handle nullable wrappers
	if (
		typeName === "ZodNullable" ||
		typeName === "ZodOptional" ||
		typeName === "ZodUnion"
	) {
		const innerSchema =
			typeName === "ZodUnion"
				? (schema as z.ZodUnion<[z.ZodType, z.ZodType]>)._def.options[0]
				: (schema as z.ZodNullable<z.ZodType> | z.ZodOptional<z.ZodType>)._def
						.innerType;

		const innerResult = toAppSchema(innerSchema);
		return { ...innerResult, nullable: true };
	}

	switch (typeName) {
		case "ZodString": {
			const stringSchema = schema as z.ZodString;
			if (stringSchema._def.checks?.some((c) => c.kind === "date")) {
				return { type: "date" };
			}
			return { type: "string" };
		}
		case "ZodNumber": {
			const numberSchema = schema as z.ZodNumber;
			if (numberSchema._def.checks?.some((c) => c.kind === "int")) {
				return { type: "integer" };
			}
			return { type: "number" };
		}
		case "ZodBoolean":
			return { type: "boolean" };
		default:
			throw new Error(`Unsupported Zod type: ${typeName}`);
	}
};
```

**Step 4: Run test to verify nullable passes**

Run: `cd libs/ts-utils && bun test src/app-schema.test.ts`
Expected: PASS - all 9 tests pass (5 primitive + 4 nullable)

**Step 5: Commit nullable support**

```bash
git add 'libs/ts-utils/src/app-schema.ts' 'libs/ts-utils/src/app-schema.test.ts'
git commit -m "feat: add nullable modifier support to toAppSchema

- Handle ZodNullable, ZodOptional, ZodUnion wrappers
- Add nullable: true flag to property definitions
- Add test coverage for nullable/optional/nullish

Attribution: OpenCode | Model: Claude Sonnet 4.5"
```

---

## Task 3: Add Array & Object Support to toAppSchema

**Files:**
- Modify: `libs/ts-utils/src/app-schema.ts`
- Modify: `libs/ts-utils/src/app-schema.test.ts`

**Step 1: Write failing test for arrays**

Add to `libs/ts-utils/src/app-schema.test.ts`:

```typescript
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
```

**Step 2: Run test to verify it fails**

Run: `cd libs/ts-utils && bun test src/app-schema.test.ts`
Expected: FAIL - array tests fail, unsupported ZodArray type

**Step 3: Implement array conversion**

Update `toAppSchema` switch in `libs/ts-utils/src/app-schema.ts`:

```typescript
	switch (typeName) {
		case "ZodString": {
			const stringSchema = schema as z.ZodString;
			if (stringSchema._def.checks?.some((c) => c.kind === "date")) {
				return { type: "date" };
			}
			return { type: "string" };
		}
		case "ZodNumber": {
			const numberSchema = schema as z.ZodNumber;
			if (numberSchema._def.checks?.some((c) => c.kind === "int")) {
				return { type: "integer" };
			}
			return { type: "number" };
		}
		case "ZodBoolean":
			return { type: "boolean" };
		case "ZodArray": {
			const arraySchema = schema as z.ZodArray<z.ZodType>;
			return {
				type: "array",
				items: toAppSchema(arraySchema._def.type),
			};
		}
		default:
			throw new Error(`Unsupported Zod type: ${typeName}`);
	}
```

**Step 4: Run test to verify arrays pass**

Run: `cd libs/ts-utils && bun test src/app-schema.test.ts`
Expected: PASS - all 12 tests pass

**Step 5: Write failing test for objects**

Add to `libs/ts-utils/src/app-schema.test.ts`:

```typescript
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
```

**Step 6: Run test to verify it fails**

Run: `cd libs/ts-utils && bun test src/app-schema.test.ts`
Expected: FAIL - object tests fail, unsupported ZodObject type

**Step 7: Implement object conversion**

Update `toAppSchema` switch in `libs/ts-utils/src/app-schema.ts`:

```typescript
		case "ZodArray": {
			const arraySchema = schema as z.ZodArray<z.ZodType>;
			return {
				type: "array",
				items: toAppSchema(arraySchema._def.type),
			};
		}
		case "ZodObject": {
			const objectSchema = schema as z.ZodObject<z.ZodRawShape>;
			const properties: Record<string, AppPropertyDefinition> = {};

			for (const [key, value] of Object.entries(objectSchema.shape)) {
				properties[key] = toAppSchema(value as z.ZodType);
			}

			return {
				type: "object",
				properties,
			};
		}
		default:
			throw new Error(`Unsupported Zod type: ${typeName}`);
```

**Step 8: Run test to verify objects pass**

Run: `cd libs/ts-utils && bun test src/app-schema.test.ts`
Expected: PASS - all 15 tests pass

**Step 9: Commit array and object support**

```bash
git add 'libs/ts-utils/src/app-schema.ts' 'libs/ts-utils/src/app-schema.test.ts'
git commit -m "feat: add array and object support to toAppSchema

- Handle ZodArray with recursive items conversion
- Handle ZodObject with properties map conversion
- Support nested objects and arrays of objects
- Add test coverage for complex types

Attribution: OpenCode | Model: Claude Sonnet 4.5"
```

---

## Task 4: Add Top-Level Object Unwrapping

**Files:**
- Modify: `libs/ts-utils/src/app-schema.ts`
- Modify: `libs/ts-utils/src/app-schema.test.ts`

**Step 1: Write failing test for top-level unwrapping**

Add to `libs/ts-utils/src/app-schema.test.ts`:

```typescript
describe("top-level object unwrapping", () => {
	it("unwraps top-level z.object() to flat properties map", () => {
		const schema = z.object({
			title: z.string(),
			pages: z.number().int().nullish(),
		});

		// toAppSchemaProperties unwraps the top-level object
		expect(toAppSchemaProperties(schema)).toEqual({
			title: { type: "string" },
			pages: { type: "integer", nullable: true },
		});
	});

	it("keeps nested objects wrapped", () => {
		const schema = z.object({
			author: z.object({
				name: z.string(),
			}),
		});

		expect(toAppSchemaProperties(schema)).toEqual({
			author: {
				type: "object",
				properties: {
					name: { type: "string" },
				},
			},
		});
	});
});
```

**Step 2: Run test to verify it fails**

Run: `cd libs/ts-utils && bun test src/app-schema.test.ts`
Expected: FAIL - toAppSchemaProperties not defined

**Step 3: Implement toAppSchemaProperties**

Add to `libs/ts-utils/src/app-schema.ts`:

```typescript
/**
 * Converts a top-level Zod object schema to an AppSchema (flat properties map).
 * This is the main export for converting seeded schemas to storage format.
 */
export const toAppSchemaProperties = (schema: z.ZodObject<z.ZodRawShape>): AppSchema => {
	const properties: AppSchema = {};

	for (const [key, value] of Object.entries(schema.shape)) {
		properties[key] = toAppSchema(value as z.ZodType);
	}

	return properties;
};
```

**Step 4: Run test to verify unwrapping passes**

Run: `cd libs/ts-utils && bun test src/app-schema.test.ts`
Expected: PASS - all 17 tests pass

**Step 5: Export from index**

Add to `libs/ts-utils/src/index.ts`:

```typescript
export {
	toAppSchema,
	toAppSchemaProperties,
	type AppSchema,
	type AppPropertyDefinition,
	type AppPrimitiveProperty,
	type AppArrayProperty,
	type AppObjectProperty,
} from "./app-schema";
```

**Step 6: Run full package tests**

Run: `cd libs/ts-utils && bun test`
Expected: PASS - all tests in package pass

**Step 7: Commit unwrapping**

```bash
git add 'libs/ts-utils/src/app-schema.ts' 'libs/ts-utils/src/app-schema.test.ts' 'libs/ts-utils/src/index.ts'
git commit -m "feat: add top-level object unwrapping for app schema

- Add toAppSchemaProperties to unwrap top-level z.object()
- Export all app schema types from package index
- Nested objects remain wrapped with type: object

Attribution: OpenCode | Model: Claude Sonnet 4.5"
```

---

## Task 5: Add fromAppSchema Converter (Primitives)

**Files:**
- Modify: `libs/ts-utils/src/app-schema.ts`
- Modify: `libs/ts-utils/src/app-schema.test.ts`

**Step 1: Write failing test for primitive conversions**

Add to `libs/ts-utils/src/app-schema.test.ts`:

```typescript
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
});
```

**Step 2: Run test to verify it fails**

Run: `cd libs/ts-utils && bun test src/app-schema.test.ts`
Expected: FAIL - fromAppSchema not defined

**Step 3: Implement fromAppSchema for primitives**

Add to `libs/ts-utils/src/app-schema.ts`:

```typescript
/**
 * Converts an AppPropertyDefinition back to a Zod schema.
 */
export const fromAppSchema = (property: AppPropertyDefinition): z.ZodType => {
	let schema: z.ZodType;

	switch (property.type) {
		case "string":
			schema = z.string();
			break;
		case "number":
			schema = z.number();
			break;
		case "integer":
			schema = z.number().int();
			break;
		case "boolean":
			schema = z.boolean();
			break;
		case "date":
			schema = z.string().date();
			break;
		case "array": {
			const arrayProp = property as AppArrayProperty;
			schema = z.array(fromAppSchema(arrayProp.items));
			break;
		}
		case "object": {
			const objectProp = property as AppObjectProperty;
			const shape: z.ZodRawShape = {};

			for (const [key, value] of Object.entries(objectProp.properties)) {
				shape[key] = fromAppSchema(value);
			}

			schema = z.object(shape);
			break;
		}
		default:
			throw new Error(`Unsupported app schema type: ${(property as { type: string }).type}`);
	}

	// Apply nullable modifier
	if (property.nullable) {
		schema = schema.nullish();
	}

	return schema;
};
```

**Step 4: Run test to verify primitives pass**

Run: `cd libs/ts-utils && bun test src/app-schema.test.ts`
Expected: PASS - all 22 tests pass (17 toAppSchema + 5 fromAppSchema)

**Step 5: Commit fromAppSchema primitives**

```bash
git add 'libs/ts-utils/src/app-schema.ts' 'libs/ts-utils/src/app-schema.test.ts'
git commit -m "feat: add fromAppSchema converter for primitives

- Convert app schema back to Zod schemas
- Support string, number, integer, boolean, date types
- Add test coverage for bidirectional conversion

Attribution: OpenCode | Model: Claude Sonnet 4.5"
```

---

## Task 6: Add fromAppSchema Support for Complex Types

**Files:**
- Modify: `libs/ts-utils/src/app-schema.test.ts`

**Step 1: Write failing test for nullable conversions**

Add to `libs/ts-utils/src/app-schema.test.ts` in `fromAppSchema` describe block:

```typescript
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
```

**Step 2: Run test to verify it passes**

Run: `cd libs/ts-utils && bun test src/app-schema.test.ts`
Expected: PASS - nullable conversion already implemented in Task 5

**Step 3: Write failing test for arrays**

Add to `libs/ts-utils/src/app-schema.test.ts` in `fromAppSchema` describe block:

```typescript
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
```

**Step 4: Run test to verify arrays pass**

Run: `cd libs/ts-utils && bun test src/app-schema.test.ts`
Expected: PASS - array conversion already implemented in Task 5

**Step 5: Write failing test for objects**

Add to `libs/ts-utils/src/app-schema.test.ts` in `fromAppSchema` describe block:

```typescript
describe("object types", () => {
	it("converts simple objects", () => {
		const schema = fromAppSchema({
			type: "object",
			properties: {
				title: { type: "string" },
				pages: { type: "integer" },
			},
		});
		expect(schema.safeParse({ title: "Book", pages: 200 }).success).toBeTrue();
		expect(schema.safeParse({ title: "Book" }).success).toBeFalse();
	});

	it("converts nested objects", () => {
		const schema = fromAppSchema({
			type: "object",
			properties: {
				author: {
					type: "object",
					properties: {
						name: { type: "string" },
					},
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
```

**Step 6: Run test to verify objects pass**

Run: `cd libs/ts-utils && bun test src/app-schema.test.ts`
Expected: PASS - object conversion already implemented in Task 5

**Step 7: Export fromAppSchema from index**

Update `libs/ts-utils/src/index.ts`:

```typescript
export {
	toAppSchema,
	toAppSchemaProperties,
	fromAppSchema,
	type AppSchema,
	type AppPropertyDefinition,
	type AppPrimitiveProperty,
	type AppArrayProperty,
	type AppObjectProperty,
} from "./app-schema";
```

**Step 8: Run full package tests**

Run: `cd libs/ts-utils && bun test`
Expected: PASS - all 32 tests pass

**Step 9: Commit fromAppSchema complex types**

```bash
git add 'libs/ts-utils/src/app-schema.ts' 'libs/ts-utils/src/app-schema.test.ts' 'libs/ts-utils/src/index.ts'
git commit -m "feat: add fromAppSchema support for complex types

- Test coverage for nullable, arrays, objects
- Export fromAppSchema from package index
- Full bidirectional conversion support

Attribution: OpenCode | Model: Claude Sonnet 4.5"
```

---

## Task 7: Add Round-Trip Conversion Tests

**Files:**
- Modify: `libs/ts-utils/src/app-schema.test.ts`

**Step 1: Write failing test for round-trip conversions**

Add to `libs/ts-utils/src/app-schema.test.ts`:

```typescript
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

		const testData = {
			title: "My Book",
			pages: 300,
			isCompilation: false,
		};

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
```

**Step 2: Run test to verify it passes**

Run: `cd libs/ts-utils && bun test src/app-schema.test.ts`
Expected: PASS - all 35 tests pass (32 + 3 round-trip)

**Step 3: Run full package tests**

Run: `cd libs/ts-utils && bun test`
Expected: PASS - all tests in package pass

**Step 4: Run typecheck**

Run: `cd libs/ts-utils && bun run typecheck`
Expected: No type errors

**Step 5: Commit round-trip tests**

```bash
git add 'libs/ts-utils/src/app-schema.test.ts'
git commit -m "test: add round-trip conversion tests

- Verify Zod -> App -> Zod conversions preserve semantics
- Test complex nested structures
- Test nullable nested properties

Attribution: OpenCode | Model: Claude Sonnet 4.5"
```

---

## Task 8: Update Backend Base to Use toAppSchemaProperties

**Files:**
- Modify: `apps/app-backend/src/lib/zod/base.ts`

**Step 1: Add @ryot/ts-utils dependency**

Update `apps/app-backend/package.json` dependencies section:

```json
"@ryot/ts-utils": "workspace:*"
```

**Step 2: Install dependencies**

Run: `cd apps/app-backend && bun install`
Expected: Dependencies installed successfully

**Step 3: Replace toStableJsonSchema implementation**

Update `apps/app-backend/src/lib/zod/base.ts`:

```typescript
import { toAppSchemaProperties } from "@ryot/ts-utils";
import { z } from "zod";

export const nullableStringSchema = z.string().nullish();
export const nullableNumberSchema = z.number().nullish();
export const nullableBooleanSchema = z.boolean().nullish();
export const nullableIntSchema = z.number().int().nullish();
export const positiveIntSchema = z.number().int().positive();
export const stringArraySchema = z.array(z.string());
export const nonEmptyStringSchema = z.string().min(1);
export const nonEmptyTrimmedStringSchema = z.string().trim().min(1);
export const stringUnknownRecordSchema = z.record(z.string(), z.unknown());

export const createNameWithOptionalSlugSchema = <TShape extends z.ZodRawShape>(
	shape: TShape,
) =>
	z.object({
		name: nonEmptyTrimmedStringSchema,
		slug: nonEmptyTrimmedStringSchema.optional(),
		...shape,
	});

export const createImportEnvelopeSchema = <TProperties extends z.ZodType>(
	propertiesSchema: TProperties,
) =>
	z
		.object({
			name: z.string(),
			properties: propertiesSchema,
			externalId: nonEmptyTrimmedStringSchema,
		})
		.strict();

export const remoteImagesAssetsSchema = z
	.object({ remoteImages: stringArraySchema })
	.strict();

/**
 * @deprecated Use toAppSchemaProperties from @ryot/ts-utils instead
 */
export const toStableJsonSchema = <TSchema extends z.ZodObject<z.ZodRawShape>>(
	schema: TSchema,
) => toAppSchemaProperties(schema);
```

**Step 4: Run typecheck**

Run: `cd apps/app-backend && bun run typecheck`
Expected: No type errors

**Step 5: Commit base.ts update**

```bash
git add 'apps/app-backend/package.json' 'apps/app-backend/src/lib/zod/base.ts'
git commit -m "refactor: replace toStableJsonSchema with toAppSchemaProperties

- Add @ryot/ts-utils dependency to backend
- Replace toJSONSchema with toAppSchemaProperties
- Keep toStableJsonSchema as deprecated wrapper for compatibility

Attribution: OpenCode | Model: Claude Sonnet 4.5"
```

---

## Task 9: Update Backend Service Validation

**Files:**
- Modify: `apps/app-backend/src/modules/entity-schemas/service.ts`

**Step 1: Update EntitySchemaPropertiesShape type**

Update `apps/app-backend/src/modules/entity-schemas/service.ts`:

```typescript
import type { AppSchema } from "@ryot/ts-utils";
import { resolveRequiredSlug } from "~/lib/slug";

type JsonObject = Record<string, unknown>;

/**
 * Entity schema properties are stored as an AppSchema (flat properties map).
 */
export type EntitySchemaPropertiesShape = AppSchema;
```

**Step 2: Write failing test for new validation**

Update `apps/app-backend/src/modules/entity-schemas/service.test.ts`:

```typescript
describe("parseEntitySchemaPropertiesSchema", () => {
	it("accepts flat properties map (new format)", () => {
		expect(
			parseEntitySchemaPropertiesSchema(
				'{"title":{"type":"string"},"pages":{"type":"integer"}}',
			),
		).toEqual({
			title: { type: "string" },
			pages: { type: "integer" },
		});
	});

	it("accepts already-parsed properties map", () => {
		const schema = {
			title: { type: "string" },
			pages: { type: "integer", nullable: true },
		};

		expect(parseEntitySchemaPropertiesSchema(schema)).toEqual(schema);
	});

	it("rejects invalid JSON", () => {
		expect(() => parseEntitySchemaPropertiesSchema("{")).toThrow(
			"Entity schema properties schema must be valid JSON",
		);
	});

	it("rejects non-object root like array, string, or null", () => {
		for (const input of ["[]", '"hello"', "null"]) {
			expect(() => parseEntitySchemaPropertiesSchema(input)).toThrow(
				"Entity schema properties schema must be a JSON object",
			);
		}
	});

	it("rejects empty properties map", () => {
		expect(() => parseEntitySchemaPropertiesSchema("{}")).toThrow(
			"Entity schema properties must contain at least one property",
		);
	});

	it("rejects property without type field", () => {
		expect(() =>
			parseEntitySchemaPropertiesSchema('{"title":{"required":true}}'),
		).toThrow('Property "title" must have a type field');
	});

	it("rejects property with invalid type", () => {
		expect(() =>
			parseEntitySchemaPropertiesSchema('{"title":{"type":"invalid"}}'),
		).toThrow('Property "title" has invalid type "invalid"');
	});

	it("rejects array property without items", () => {
		expect(() =>
			parseEntitySchemaPropertiesSchema('{"tags":{"type":"array"}}'),
		).toThrow('Property "tags" with type "array" must have an items field');
	});

	it("rejects object property without properties", () => {
		expect(() =>
			parseEntitySchemaPropertiesSchema('{"metadata":{"type":"object"}}'),
		).toThrow(
			'Property "metadata" with type "object" must have a properties field',
		);
	});

	it("accepts complex nested structure", () => {
		const schema = {
			people: {
				type: "array",
				items: {
					type: "object",
					properties: {
						role: { type: "string" },
						identifier: { type: "string" },
					},
				},
			},
		};

		expect(parseEntitySchemaPropertiesSchema(schema)).toEqual(schema);
	});
});
```

**Step 3: Run test to verify it fails**

Run: `cd apps/app-backend && bun test src/modules/entity-schemas/service.test.ts`
Expected: FAIL - validation logic doesn't match new format

**Step 4: Implement new validation logic**

Update `parseEntitySchemaPropertiesSchema` in `apps/app-backend/src/modules/entity-schemas/service.ts`:

```typescript
const isJsonObject = (value: unknown) => {
	return typeof value === "object" && value !== null && !Array.isArray(value);
};

const VALID_PRIMITIVE_TYPES = ["string", "number", "integer", "boolean", "date"];

const validatePropertyDefinition = (
	key: string,
	property: unknown,
): void => {
	if (!isJsonObject(property)) {
		throw new Error(`Property "${key}" must be an object`);
	}

	const prop = property as JsonObject;

	if (!prop.type || typeof prop.type !== "string") {
		throw new Error(`Property "${key}" must have a type field`);
	}

	const type = prop.type;

	if (
		!VALID_PRIMITIVE_TYPES.includes(type) &&
		type !== "array" &&
		type !== "object"
	) {
		throw new Error(`Property "${key}" has invalid type "${type}"`);
	}

	if (type === "array") {
		if (!prop.items) {
			throw new Error(
				`Property "${key}" with type "array" must have an items field`,
			);
		}
		// Recursively validate items
		validatePropertyDefinition(`${key}[]`, prop.items);
	}

	if (type === "object") {
		if (!isJsonObject(prop.properties)) {
			throw new Error(
				`Property "${key}" with type "object" must have a properties field`,
			);
		}
		// Recursively validate nested properties
		const nestedProps = prop.properties as JsonObject;
		for (const [nestedKey, nestedValue] of Object.entries(nestedProps)) {
			validatePropertyDefinition(`${key}.${nestedKey}`, nestedValue);
		}
	}
};

export const parseEntitySchemaPropertiesSchema = (
	input: unknown,
): EntitySchemaPropertiesShape => {
	let parsed = input;

	if (typeof input === "string") {
		try {
			parsed = JSON.parse(input);
		} catch {
			throw new Error("Entity schema properties schema must be valid JSON");
		}
	}

	if (!isJsonObject(parsed))
		throw new Error("Entity schema properties schema must be a JSON object");

	const parsedObject = parsed as JsonObject;

	const keys = Object.keys(parsedObject);
	if (keys.length === 0) {
		throw new Error(
			"Entity schema properties must contain at least one property",
		);
	}

	// Validate each property definition
	for (const [key, value] of Object.entries(parsedObject)) {
		validatePropertyDefinition(key, value);
	}

	return parsedObject as EntitySchemaPropertiesShape;
};
```

**Step 5: Remove deprecated isEntitySchemaPropertiesShape**

Remove the `isEntitySchemaPropertiesShape` function from `apps/app-backend/src/modules/entity-schemas/service.ts` (no longer needed).

Update exports:

```typescript
export const isEntitySchemaPropertiesString = (value: string) => {
	try {
		parseEntitySchemaPropertiesSchema(value);
		return true;
	} catch {
		return false;
	}
};
```

**Step 6: Run test to verify validation passes**

Run: `cd apps/app-backend && bun test src/modules/entity-schemas/service.test.ts`
Expected: PASS - all service tests pass with new validation

**Step 7: Update resolveEntitySchemaCreateInput test**

Update the test in `apps/app-backend/src/modules/entity-schemas/service.test.ts`:

```typescript
describe("resolveEntitySchemaCreateInput", () => {
	it("returns normalized payload", () => {
		expect(
			resolveEntitySchemaCreateInput({
				name: "  Book Details  ",
				slug: "  My_Custom Schema  ",
				propertiesSchema: '{"title":{"type":"string"}}',
			}),
		).toEqual({
			name: "Book Details",
			slug: "my-custom-schema",
			propertiesSchema: { title: { type: "string" } },
		});
	});
});
```

**Step 8: Run test to verify it passes**

Run: `cd apps/app-backend && bun test src/modules/entity-schemas/service.test.ts`
Expected: PASS - all tests pass

**Step 9: Run backend typecheck**

Run: `cd apps/app-backend && bun run typecheck`
Expected: No type errors

**Step 10: Commit service validation updates**

```bash
git add 'apps/app-backend/src/modules/entity-schemas/service.ts' 'apps/app-backend/src/modules/entity-schemas/service.test.ts'
git commit -m "refactor: update entity schema validation for app schema format

- Accept flat properties map instead of type+properties wrapper
- Validate property types recursively (primitives, arrays, objects)
- Remove isEntitySchemaPropertiesShape (no longer needed)
- Update EntitySchemaPropertiesShape type to AppSchema
- Add comprehensive validation test coverage

Attribution: OpenCode | Model: Claude Sonnet 4.5"
```

---

## Task 10: Update Backend Schema Validation

**Files:**
- Modify: `apps/app-backend/src/modules/entity-schemas/schemas.ts`

**Step 1: Read current schemas file**

Run: `cat apps/app-backend/src/modules/entity-schemas/schemas.ts`
Expected: See current Zod schema definitions

**Step 2: Update entitySchemaPropertiesObjectSchema**

Update `apps/app-backend/src/modules/entity-schemas/schemas.ts`:

```typescript
import { z } from "zod";

/**
 * App schema format: flat properties map where each value is a property definition.
 * Property definitions must have a "type" field and optional "nullable"/"required" modifiers.
 */
export const entitySchemaPropertiesObjectSchema: z.ZodType<
	Record<string, unknown>
> = z.record(z.string(), z.unknown()).refine(
	(value) => {
		const keys = Object.keys(value);
		return keys.length > 0;
	},
	{
		message: "Entity schema properties must contain at least one property",
	},
);

export const entitySchemaPropertiesInputSchema = z.union([
	z.string(),
	entitySchemaPropertiesObjectSchema,
]);
```

**Step 3: Run backend typecheck**

Run: `cd apps/app-backend && bun run typecheck`
Expected: No type errors

**Step 4: Commit schemas update**

```bash
git add 'apps/app-backend/src/modules/entity-schemas/schemas.ts'
git commit -m "refactor: update entity schema Zod schemas for app format

- Accept flat properties map in entitySchemaPropertiesObjectSchema
- Require at least one property in the map
- Maintain union with string for JSON input

Attribution: OpenCode | Model: Claude Sonnet 4.5"
```

---

## Task 11: Update Backend Media Schemas

**Files:**
- Modify: `apps/app-backend/src/lib/zod/media/book.ts`
- Modify: `apps/app-backend/src/lib/zod/media/anime.ts`
- Modify: `apps/app-backend/src/lib/zod/media/manga.ts`

**Step 1: Update book.ts to use toAppSchemaProperties**

Update `apps/app-backend/src/lib/zod/media/book.ts`:

```typescript
import { toAppSchemaProperties } from "@ryot/ts-utils";
import { z } from "zod";
import {
	createImportEnvelopeSchema,
	nullableBooleanSchema,
	nullableIntSchema,
} from "../base";
import { mediaPropertiesSchema } from "./common";

const schemaImportPerson = z
	.object({ role: z.string(), source: z.string(), identifier: z.string() })
	.strict();

export const bookPropertiesSchema = mediaPropertiesSchema.extend({
	pages: nullableIntSchema,
	isCompilation: nullableBooleanSchema,
	people: z.array(schemaImportPerson),
});

export const bookPropertiesJsonSchema =
	toAppSchemaProperties(bookPropertiesSchema);

export const schemaImportResponse =
	createImportEnvelopeSchema(bookPropertiesSchema);

export type SchemaImportResponse = z.infer<typeof schemaImportResponse>;

export const readEventPropertiesSchema = z
	.object({
		finishedAt: z.iso.datetime().nullish(),
		numberOfProgressEvents: nullableIntSchema,
		platforms: z.array(z.string()).nullish(),
	})
	.strict();

export const progressEventPropertiesSchema = z
	.object({
		platforms: z.array(z.string()).nullish(),
		progressPercent: z.number().min(0).max(100),
	})
	.strict();

export const readEventPropertiesJsonSchema = toAppSchemaProperties(
	readEventPropertiesSchema,
);

export const progressEventPropertiesJsonSchema = toAppSchemaProperties(
	progressEventPropertiesSchema,
);
```

**Step 2: Update anime.ts to use toAppSchemaProperties**

Read the file first:
Run: `cat apps/app-backend/src/lib/zod/media/anime.ts`

Update `apps/app-backend/src/lib/zod/media/anime.ts` similarly by replacing `toStableJsonSchema` with `toAppSchemaProperties` and adding the import.

**Step 3: Update manga.ts to use toAppSchemaProperties**

Read the file first:
Run: `cat apps/app-backend/src/lib/zod/media/manga.ts`

Update `apps/app-backend/src/lib/zod/media/manga.ts` similarly by replacing `toStableJsonSchema` with `toAppSchemaProperties` and adding the import.

**Step 4: Run backend typecheck**

Run: `cd apps/app-backend && bun run typecheck`
Expected: No type errors

**Step 5: Run backend tests**

Run: `cd apps/app-backend && bun test`
Expected: All tests pass

**Step 6: Commit media schemas update**

```bash
git add 'apps/app-backend/src/lib/zod/media/book.ts' 'apps/app-backend/src/lib/zod/media/anime.ts' 'apps/app-backend/src/lib/zod/media/manga.ts'
git commit -m "refactor: migrate media schemas to toAppSchemaProperties

- Replace toStableJsonSchema with toAppSchemaProperties in book.ts
- Replace toStableJsonSchema with toAppSchemaProperties in anime.ts
- Replace toStableJsonSchema with toAppSchemaProperties in manga.ts
- Event schemas now generate app schema format

Attribution: OpenCode | Model: Claude Sonnet 4.5"
```

---

## Task 12: Update Frontend Form Builder

**Files:**
- Modify: `apps/app-frontend/src/features/entity-schemas/form.ts`

**Step 1: Add @ryot/ts-utils dependency**

Update `apps/app-frontend/package.json` dependencies section:

```json
"@ryot/ts-utils": "workspace:*"
```

**Step 2: Install dependencies**

Run: `cd apps/app-frontend && bun install`
Expected: Dependencies installed successfully

**Step 3: Update buildEntitySchemaPropertiesSchema**

Update `apps/app-frontend/src/features/entity-schemas/form.ts`:

```typescript
export const buildEntitySchemaPropertiesSchema = (
	properties: EntitySchemaPropertyRow[],
) => {
	const propertiesMap: Record<string, unknown> = {};
	const requiredKeys: string[] = [];

	for (const property of properties) {
		const key = property.key.trim();
		const propertyDef: Record<string, unknown> = {};

		switch (property.type) {
			case "string":
				propertyDef.type = "string";
				break;
			case "number":
				propertyDef.type = "number";
				break;
			case "integer":
				propertyDef.type = "integer";
				break;
			case "boolean":
				propertyDef.type = "boolean";
				break;
			case "date":
				propertyDef.type = "date";
				break;
		}

		if (property.required) {
			propertyDef.required = true;
		}

		propertiesMap[key] = propertyDef;
	}

	return propertiesMap;
};
```

**Step 4: Update serializeEntitySchemaProperties**

Update `apps/app-frontend/src/features/entity-schemas/form.ts`:

```typescript
export const serializeEntitySchemaProperties = (
	properties: EntitySchemaPropertyRow[],
) => {
	const schema = buildEntitySchemaPropertiesSchema(properties);
	return JSON.stringify(schema);
};
```

**Step 5: Write failing tests for new format**

Update `apps/app-frontend/src/features/entity-schemas/form.test.ts`:

```typescript
describe("buildEntitySchemaPropertiesSchema", () => {
	it("maps scalar property types and trims keys", () => {
		expect(
			buildEntitySchemaPropertiesSchema([
				{ key: " title ", type: "string", required: false },
				{ key: "rating", type: "number", required: false },
				{ key: "isOwned", type: "boolean", required: false },
			]),
		).toEqual({
			title: { type: "string" },
			rating: { type: "number" },
			isOwned: { type: "boolean" },
		});
	});

	it("maps integer type correctly", () => {
		expect(
			buildEntitySchemaPropertiesSchema([
				{ key: "pages", type: "integer", required: false },
			]),
		).toEqual({
			pages: { type: "integer" },
		});
	});

	it("maps date rows and includes required flag when present", () => {
		expect(
			buildEntitySchemaPropertiesSchema([
				{ key: "releasedOn", type: "date", required: true },
				{ key: "summary", type: "string", required: false },
			]),
		).toEqual({
			releasedOn: { type: "date", required: true },
			summary: { type: "string" },
		});
	});
});
```

**Step 6: Run test to verify it passes**

Run: `cd apps/app-frontend && bun test src/features/entity-schemas/form.test.ts`
Expected: PASS - buildEntitySchemaPropertiesSchema tests pass

**Step 7: Update serializeEntitySchemaProperties tests**

Update `apps/app-frontend/src/features/entity-schemas/form.test.ts`:

```typescript
describe("serializeEntitySchemaProperties", () => {
	it("returns deterministic JSON without required flag for optional rows", () => {
		expect(
			serializeEntitySchemaProperties([
				{ key: " title ", type: "string", required: false },
				{ key: "rating", type: "number", required: false },
			]),
		).toBe('{"title":{"type":"string"},"rating":{"type":"number"}}');
	});

	it("returns deterministic JSON with required flag for date rows", () => {
		expect(
			serializeEntitySchemaProperties([
				{ key: "releasedOn", type: "date", required: true },
			]),
		).toBe('{"releasedOn":{"type":"date","required":true}}');
	});
});
```

**Step 8: Run test to verify it passes**

Run: `cd apps/app-frontend && bun test src/features/entity-schemas/form.test.ts`
Expected: PASS - serializeEntitySchemaProperties tests pass

**Step 9: Update toCreateEntitySchemaPayload test**

Update `apps/app-frontend/src/features/entity-schemas/form.test.ts`:

```typescript
describe("toCreateEntitySchemaPayload", () => {
	it("trims name and slug, includes facetId, and serializes property rows", () => {
		expect(
			toCreateEntitySchemaPayload(
				{
					name: "  Books  ",
					slug: " books ",
					properties: [
						{ key: " releasedOn ", type: "date", required: true },
						{ key: "rating", type: "number", required: false },
					],
				},
				"facet-123",
			),
		).toEqual({
			facetId: "facet-123",
			name: "Books",
			slug: "books",
			propertiesSchema:
				'{"releasedOn":{"type":"date","required":true},"rating":{"type":"number"}}',
		});
	});
});
```

**Step 10: Run all frontend form tests**

Run: `cd apps/app-frontend && bun test src/features/entity-schemas/form.test.ts`
Expected: PASS - all 19 tests pass

**Step 11: Run frontend typecheck**

Run: `turbo typecheck --filter=@ryot/app-frontend`
Expected: No type errors

**Step 12: Commit frontend form builder update**

```bash
git add 'apps/app-frontend/package.json' 'apps/app-frontend/src/features/entity-schemas/form.ts' 'apps/app-frontend/src/features/entity-schemas/form.test.ts'
git commit -m "refactor: update frontend form builder for app schema format

- Add @ryot/ts-utils dependency to frontend
- Update buildEntitySchemaPropertiesSchema to produce flat map
- Remove type: object wrapper, use property-level required flag
- Update all test assertions for new format

Attribution: OpenCode | Model: Claude Sonnet 4.5"
```

---

## Task 13: Update Frontend Model Types

**Files:**
- Modify: `apps/app-frontend/src/features/entity-schemas/model.ts`

**Step 1: Read current model file**

Run: `cat apps/app-frontend/src/features/entity-schemas/model.ts`
Expected: See AppEntitySchema type definition

**Step 2: Update AppEntitySchema type**

Update `apps/app-frontend/src/features/entity-schemas/model.ts`:

```typescript
import type { AppSchema } from "@ryot/ts-utils";

export type AppEntitySchema = {
	id: string;
	name: string;
	slug: string;
	facetId: string;
	propertiesSchema: AppSchema;
};
```

**Step 3: Run frontend typecheck**

Run: `turbo typecheck --filter=@ryot/app-frontend`
Expected: No type errors (or see which files need updates)

**Step 4: If typecheck fails, update consuming files**

Check which files reference `propertiesSchema.properties` and update them:

Search for usage:
Run: `cd apps/app-frontend && grep -r "propertiesSchema\.properties" src/`

Update any files that access `.properties` to access `propertiesSchema` directly (it's now a flat map).

**Step 5: Run frontend typecheck again**

Run: `turbo typecheck --filter=@ryot/app-frontend`
Expected: No type errors

**Step 6: Commit model type update**

```bash
git add 'apps/app-frontend/src/features/entity-schemas/model.ts'
git commit -m "refactor: update AppEntitySchema type for app schema format

- Change propertiesSchema type to AppSchema (flat map)
- Import AppSchema from @ryot/ts-utils
- Remove references to nested .properties access

Attribution: OpenCode | Model: Claude Sonnet 4.5"
```

---

## Task 14: Add Integer Type to Frontend Form

**Files:**
- Modify: `apps/app-frontend/src/features/entity-schemas/form.ts`

**Step 1: Update EntitySchemaPropertyType**

Update `apps/app-frontend/src/features/entity-schemas/form.ts`:

```typescript
export const entitySchemaPropertyTypes = [
	"string",
	"number",
	"integer",
	"boolean",
	"date",
] as const;

export type EntitySchemaPropertyType =
	(typeof entitySchemaPropertyTypes)[number];
```

**Step 2: Update buildDefaultEntitySchemaPropertyRow if needed**

Verify default type is still valid (should be "string").

**Step 3: Run frontend tests**

Run: `cd apps/app-frontend && bun test src/features/entity-schemas/form.test.ts`
Expected: All tests pass

**Step 4: Run frontend typecheck**

Run: `turbo typecheck --filter=@ryot/app-frontend`
Expected: No type errors

**Step 5: Commit integer type addition**

```bash
git add 'apps/app-frontend/src/features/entity-schemas/form.ts'
git commit -m "feat: add integer type to frontend entity schema form

- Add integer to entitySchemaPropertyTypes
- Update EntitySchemaPropertyType union

Attribution: OpenCode | Model: Claude Sonnet 4.5"
```

---

## Task 15: Update Properties Builder UI for Integer Type

**Files:**
- Modify: `apps/app-frontend/src/features/entity-schemas/properties-builder.tsx`

**Step 1: Read properties builder**

Run: `cat apps/app-frontend/src/features/entity-schemas/properties-builder.tsx`
Expected: See Select component with type options

**Step 2: Add integer option to type Select**

Find the Select component for property type and verify it includes "integer" option. If using `entitySchemaPropertyTypes` array, it should automatically include integer.

Example:
```tsx
<Select.Root
	name={`${namePrefix}.type`}
	defaultValue={property.type}
>
	<Select.Trigger />
	<Select.Content>
		{entitySchemaPropertyTypes.map((type) => (
			<Select.Item key={type} value={type}>
				{capitalizeFirst(type)}
			</Select.Item>
		))}
	</Select.Content>
</Select.Root>
```

**Step 3: Run frontend typecheck**

Run: `turbo typecheck --filter=@ryot/app-frontend`
Expected: No type errors

**Step 4: Commit properties builder update**

```bash
git add 'apps/app-frontend/src/features/entity-schemas/properties-builder.tsx'
git commit -m "feat: add integer option to properties builder UI

- Integer type now available in property type dropdown
- Uses entitySchemaPropertyTypes array

Attribution: OpenCode | Model: Claude Sonnet 4.5"
```

---

## Task 16: Run Full Monorepo Verification

**Files:**
- N/A - verification only

**Step 1: Run all tests**

Run: `turbo test`
Expected: All tests pass in all packages

**Step 2: Run all typechecks**

Run: `turbo typecheck`
Expected: No type errors in any package

**Step 3: Run linting**

Run: `turbo lint`
Expected: No lint errors

**Step 4: Commit verification checkpoint**

```bash
git commit --allow-empty -m "chore: verify custom app schema format migration

- All tests passing
- All typechecks passing
- All lint checks passing

Attribution: OpenCode | Model: Claude Sonnet 4.5"
```

---

## Task 17: Update Route Files Using propertiesSchema

**Files:**
- Search: `apps/app-frontend/src/routes/**/*.tsx`
- Modify: Any files accessing `propertiesSchema.properties`

**Step 1: Find files accessing properties**

Run: `cd apps/app-frontend && grep -r "propertiesSchema\.properties" src/routes/`
Expected: List of files that need updating

**Step 2: For each file, update property access**

Change from:
```typescript
const properties = schema.propertiesSchema.properties;
```

To:
```typescript
const properties = schema.propertiesSchema;
```

**Step 3: Run frontend typecheck**

Run: `turbo typecheck --filter=@ryot/app-frontend`
Expected: No type errors

**Step 4: Commit route updates**

```bash
git add 'apps/app-frontend/src/routes/'
git commit -m "refactor: update routes to use flat propertiesSchema

- Remove .properties access (now flat at top level)
- Update all route files referencing entity schemas

Attribution: OpenCode | Model: Claude Sonnet 4.5"
```

---

## Task 18: Final Integration Test

**Files:**
- Verify: Backend seed, frontend form, full flow

**Step 1: Clear database (user to do this)**

Instruct user:
```
Please clear your database to trigger seeding on next startup:
rm -f data/db.sqlite
```

**Step 2: Start backend**

Run: `turbo dev --filter=@ryot/app-backend`
Expected: Backend starts, runs seeds with new app schema format

**Step 3: Check seed data format**

Run: `cd apps/app-backend && bun run db:studio`
Open database and inspect `entity_schemas` table `properties_schema` column.
Expected: JSON matches app schema format (flat properties map)

**Step 4: Test frontend form**

1. Open frontend: `turbo dev --filter=@ryot/app-frontend`
2. Navigate to entity schemas page
3. Create new schema with properties
4. Submit form

Expected: Form submits successfully, schema saved to database

**Step 5: Verify saved schema format**

Check database again for newly created schema.
Expected: Properties schema in app format

**Step 6: Document completion**

Create summary in commit message.

**Step 7: Final commit**

```bash
git commit --allow-empty -m "docs: complete custom app schema format migration

Migration complete:
- Backend seeds use toAppSchemaProperties
- Frontend form produces app schema format
- Validation accepts flat properties map
- All tests passing
- Database schemas use new format

Attribution: OpenCode | Model: Claude Sonnet 4.5"
```

---

## Summary

**Total Tasks:** 18
**Estimated Time:** 3-4 hours

**Key Milestones:**
1. Tasks 1-7: Implement bidirectional converters in `@ryot/ts-utils` with tests
2. Tasks 8-11: Migrate backend to use new format
3. Tasks 12-15: Migrate frontend to produce new format
4. Tasks 16-18: Verification and integration testing

**Dependencies:**
- `@ryot/ts-utils` must be completed before backend/frontend can use it
- Backend validation must be updated before frontend can submit new format
- User must clear database to trigger re-seeding

**Verification Strategy:**
- TDD throughout (tests before implementation)
- Frequent commits (every 1-2 tasks)
- Typecheck after each task
- Full monorepo verification at Task 16
- Integration test at Task 18
