import { describe, expect, it } from "bun:test";
import {
	buildCreateEntityFormSchema,
	buildDefaultEntityFormValues,
	toCreateEntityPayload,
} from "./form";

describe("buildCreateEntityFormSchema", () => {
	it("builds schema for simple string and number properties", () => {
		const propertiesSchema = {
			fields: {
				pages: {
					label: "Pages",
					description: "Pages",
					type: "integer" as const,
				},
				title: {
					label: "Title",
					description: "Title",
					type: "string" as const,
					validation: { required: true as const },
				},
			},
		};

		const schema = buildCreateEntityFormSchema(propertiesSchema);

		const result = schema.safeParse({
			name: "Test Book",
			properties: { pages: 350, title: "The Great Book" },
		});

		expect(result.success).toBeTrue();
	});

	it("rejects invalid property types", () => {
		const propertiesSchema = {
			fields: {
				title: {
					label: "Title",
					description: "Title",
					type: "string" as const,
					validation: { required: true as const },
				},
			},
		};

		const schema = buildCreateEntityFormSchema(propertiesSchema);

		const result = schema.safeParse({
			name: "Test Book",
			properties: { title: 123 },
		});

		expect(result.success).toBeFalse();
	});

	it("requires required properties", () => {
		const propertiesSchema = {
			fields: {
				title: {
					label: "Title",
					description: "Title",
					type: "string" as const,
					validation: { required: true as const },
				},
			},
		};

		const schema = buildCreateEntityFormSchema(propertiesSchema);

		const result = schema.safeParse({ properties: {}, name: "Test Book" });

		expect(result.success).toBeFalse();
	});

	it("allows optional properties to be missing", () => {
		const propertiesSchema = {
			fields: {
				subtitle: {
					label: "Subtitle",
					description: "Subtitle",
					type: "string" as const,
				},
				title: {
					label: "Title",
					description: "Title",
					type: "string" as const,
					validation: { required: true as const },
				},
			},
		};

		const schema = buildCreateEntityFormSchema(propertiesSchema);

		const result = schema.safeParse({
			name: "Test Book",
			properties: { title: "The Great Book" },
		});

		expect(result.success).toBeTrue();
	});

	it("validates nested object properties", () => {
		const propertiesSchema = {
			fields: {
				metadata: {
					label: "Metadata",
					description: "Metadata",
					type: "object" as const,
					properties: {
						year: {
							label: "Year",
							description: "Year",
							type: "integer" as const,
						},
						author: {
							label: "Author",
							description: "Author",
							type: "string" as const,
						},
					},
				},
			},
		};

		const schema = buildCreateEntityFormSchema(propertiesSchema);

		const result = schema.safeParse({
			name: "Test Book",
			properties: { metadata: { year: 2024, author: "John Doe" } },
		});

		expect(result.success).toBeTrue();
	});

	it("validates array properties", () => {
		const propertiesSchema = {
			fields: {
				tags: {
					label: "Tags",
					description: "Tags",
					type: "array" as const,
					items: {
						label: "Item",
						description: "Item",
						type: "string" as const,
					},
				},
			},
		};

		const schema = buildCreateEntityFormSchema(propertiesSchema);

		const result = schema.safeParse({
			name: "Test Book",
			properties: { tags: ["fiction", "adventure"] },
		});

		expect(result.success).toBeTrue();
	});

	it("rejects when required primitive properties are missing", () => {
		const propertiesSchema = {
			fields: {
				title: {
					label: "Title",
					description: "Title",
					type: "string" as const,
					validation: { required: true as const },
				},
			},
		};

		const schema = buildCreateEntityFormSchema(propertiesSchema);

		const result = schema.safeParse({
			name: "Test Book",
			properties: {},
		});

		expect(result.success).toBeFalse();
	});

	it("rejects unsupported required properties (arrays and objects)", () => {
		const propertiesSchema = {
			fields: {
				title: {
					label: "Title",
					description: "Title",
					type: "string" as const,
					validation: { required: true as const },
				},
				tags: {
					label: "Tags",
					description: "Tags",
					type: "array" as const,
					items: { label: "Tag", description: "Tag", type: "string" as const },
					validation: { required: true as const },
				},
				metadata: {
					label: "Metadata",
					description: "Metadata",
					type: "object" as const,
					properties: {
						year: {
							label: "Year",
							description: "Year",
							type: "integer" as const,
						},
					},
					validation: { required: true as const },
				},
			},
		};

		const schema = buildCreateEntityFormSchema(propertiesSchema);

		const result = schema.safeParse({
			name: "Test Book",
			properties: { title: "The Book" },
		});

		expect(result.success).toBeFalse();
		if (!result.success) {
			expect(result.error.issues[0]?.path).toEqual(["properties"]);
			expect(result.error.issues[0]?.message).toInclude(
				"requires unsupported properties",
			);
		}
	});

	it("filters out non-primitive properties during validation", () => {
		const propertiesSchema = {
			fields: {
				title: {
					label: "Title",
					description: "Title",
					type: "string" as const,
					validation: { required: true as const },
				},
				tags: {
					label: "Tags",
					description: "Tags",
					type: "array" as const,
					items: { label: "Tag", description: "Tag", type: "string" as const },
				},
			},
		};

		const schema = buildCreateEntityFormSchema(propertiesSchema);

		const result = schema.safeParse({
			name: "Test Book",
			properties: { title: "The Book", tags: ["a", "b", "c"] },
		});

		expect(result.success).toBeTrue();
	});

	it("accepts a valid enum value and rejects out-of-options values", () => {
		const propertiesSchema = {
			fields: {
				status: {
					label: "Status",
					description: "Status",
					type: "enum" as const,
					validation: { required: true as const },
					options: ["draft", "published"] as [string, ...string[]],
				},
			},
		};

		const schema = buildCreateEntityFormSchema(propertiesSchema);

		expect(
			schema.safeParse({ name: "Book", properties: { status: "draft" } })
				.success,
		).toBeTrue();
		expect(
			schema.safeParse({ name: "Book", properties: { status: "unknown" } })
				.success,
		).toBeFalse();
	});

	it("accepts valid enum-array values and rejects out-of-options items", () => {
		const propertiesSchema = {
			fields: {
				genres: {
					label: "Genres",
					description: "Genres",
					type: "enum-array" as const,
					options: ["fiction", "mystery"] as [string, ...string[]],
				},
			},
		};

		const schema = buildCreateEntityFormSchema(propertiesSchema);

		expect(
			schema.safeParse({ name: "Book", properties: { genres: ["fiction"] } })
				.success,
		).toBeTrue();
		expect(
			schema.safeParse({
				name: "Book",
				properties: { genres: ["fiction", "invalid"] },
			}).success,
		).toBeFalse();
	});

	it("applies conditional required rules", () => {
		const schema = buildCreateEntityFormSchema({
			fields: {
				progressPercent: {
					label: "Progress Percent",
					description: "Progress Percent",
					type: "number" as const,
				},
				status: {
					label: "Status",
					description: "Status",
					type: "string" as const,
					validation: { required: true as const },
				},
			},
			rules: [
				{
					path: ["progressPercent"],
					kind: "validation" as const,
					validation: { required: true as const },
					when: {
						path: ["status"],
						value: "completed",
						operator: "eq" as const,
					},
				},
			],
		});

		expect(
			schema.safeParse({
				image: null,
				name: "Test Book",
				properties: { status: "draft" },
			}).success,
		).toBeTrue();
		expect(
			schema.safeParse({
				image: null,
				name: "Test Book",
				properties: { status: "completed" },
			}).success,
		).toBeFalse();
		expect(
			schema.safeParse({
				image: null,
				name: "Test Book",
				properties: { status: "completed", progressPercent: 90 },
			}).success,
		).toBeTrue();
	});
});

describe("buildDefaultEntityFormValues", () => {
	it("creates default values with empty name and required properties", () => {
		const propertiesSchema = {
			fields: {
				pages: {
					label: "Pages",
					description: "Pages",
					type: "integer" as const,
				},
				title: {
					label: "Title",
					description: "Title",
					type: "string" as const,
					validation: { required: true as const },
				},
			},
		};

		const values = buildDefaultEntityFormValues(propertiesSchema);

		expect(values.name).toBe("");
		expect(values.properties).toMatchObject({ title: "" });
		expect(values.properties.pages).toBeUndefined();
	});

	it("includes default values for all property types", () => {
		const propertiesSchema = {
			fields: {
				title: {
					label: "Title",
					description: "Title",
					type: "string" as const,
					validation: { required: true as const },
				},
				pages: {
					label: "Pages",
					description: "Pages",
					type: "integer" as const,
					validation: { required: true as const },
				},
				active: {
					label: "Active",
					description: "Active",
					type: "boolean" as const,
					validation: { required: true as const },
				},
			},
		};

		const values = buildDefaultEntityFormValues(propertiesSchema);

		expect(values.properties).toMatchObject({
			pages: 0,
			title: "",
			active: false,
		});
	});

	it("creates default values for nested object properties", () => {
		const propertiesSchema = {
			fields: {
				metadata: {
					label: "Metadata",
					description: "Metadata",
					type: "object" as const,
					validation: { required: true as const },
					properties: {
						year: {
							label: "Year",
							description: "Year",
							type: "integer" as const,
						},
						author: {
							label: "Author",
							description: "Author",
							type: "string" as const,
						},
					},
				},
			},
		};

		const values = buildDefaultEntityFormValues(propertiesSchema);

		expect(values.properties.metadata).toEqual({ year: 0, author: "" });
	});

	it("defaults required enum to empty string and enum-array to empty array", () => {
		const propertiesSchema = {
			fields: {
				genres: {
					label: "Genres",
					description: "Genres",
					type: "enum-array" as const,
					validation: { required: true as const },
					options: ["fiction", "mystery"] as [string, ...string[]],
				},
				status: {
					label: "Status",
					description: "Status",
					type: "enum" as const,
					validation: { required: true as const },
					options: ["draft", "published"] as [string, ...string[]],
				},
			},
		};

		const values = buildDefaultEntityFormValues(propertiesSchema);

		expect(values.properties.status).toBe("");
		expect(values.properties.genres).toEqual([]);
	});
});

describe("toCreateEntityPayload", () => {
	it("trims name and includes entitySchemaId and properties", () => {
		const formValues = {
			image: null,
			name: "  Test Book  ",
			properties: { pages: 350, title: "The Great Book" },
		};

		const propertiesSchema = {
			fields: {
				pages: {
					label: "Pages",
					description: "Pages",
					type: "integer" as const,
				},
				title: {
					label: "Title",
					description: "Title",
					type: "string" as const,
				},
			},
		};

		const payload = toCreateEntityPayload(
			formValues,
			"schema-123",
			propertiesSchema,
		);

		expect(payload).toEqual({
			image: null,
			name: "Test Book",
			entitySchemaId: "schema-123",
			properties: { pages: 350, title: "The Great Book" },
		});
	});

	it("filters out non-primitive properties from payload", () => {
		const formValues = {
			image: null,
			name: "Test Book",
			properties: {
				title: "The Great Book",
				tags: ["fiction", "adventure"],
				metadata: { year: 2024 },
			},
		};

		const propertiesSchema = {
			fields: {
				title: {
					label: "Title",
					description: "Title",
					type: "string" as const,
				},
				tags: {
					label: "Tags",
					description: "Tags",
					type: "array" as const,
					items: { label: "Tag", description: "Tag", type: "string" as const },
				},
				metadata: {
					label: "Metadata",
					description: "Metadata",
					type: "object" as const,
					properties: {
						year: {
							label: "Year",
							description: "Year",
							type: "integer" as const,
						},
					},
				},
			},
		};

		const payload = toCreateEntityPayload(
			formValues,
			"schema-123",
			propertiesSchema,
		);

		expect(payload.properties).toEqual({
			title: "The Great Book",
		});
	});
});
