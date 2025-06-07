import { describe, expect, it } from "bun:test";
import { createCollection, resolveCollectionName } from "./service";

const mockCollectionSchemaId = "mock-schema-id";

const mockDeps = {
	createCollectionForUser: async (input: {
		name: string;
		userId: string;
		entitySchemaId: string;
		properties: Record<string, unknown>;
	}) => ({
		id: "mock-collection-id",
		name: input.name,
		image: null,
		externalId: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		entitySchemaId: input.entitySchemaId,
		properties: input.properties,
		sandboxScriptId: null,
	}),
	getBuiltinCollectionSchema: async () => ({
		id: mockCollectionSchemaId,
		propertiesSchema: {
			fields: {
				membershipPropertiesSchema: {
					type: "object" as const,
					properties: {},
					unknownKeys: "strip" as const,
				},
			},
		},
	}),
};

describe("resolveCollectionName", () => {
	it("returns the name when valid", () => {
		expect(resolveCollectionName("My Collection")).toBe("My Collection");
	});

	it("throws when name is empty", () => {
		expect(() => resolveCollectionName("")).toThrow(
			"Collection name is required",
		);
	});

	it("throws when name is whitespace", () => {
		expect(() => resolveCollectionName("   ")).toThrow(
			"Collection name is required",
		);
	});
});

describe("createCollection", () => {
	it("creates a collection with valid input", async () => {
		const result = await createCollection(
			{
				body: { name: "Test Collection" },
				userId: "user-1",
			},
			mockDeps,
		);

		expect("data" in result).toBe(true);
		if ("data" in result) {
			expect(result.data.name).toBe("Test Collection");
			expect(result.data.entitySchemaId).toBe(mockCollectionSchemaId);
			expect(result.data.properties).toEqual({});
		}
	});

	it("creates a collection with membershipPropertiesSchema", async () => {
		const membershipSchema = {
			fields: {
				friendWhoRecommendedIt: { type: "string" as const },
			},
		};

		const result = await createCollection(
			{
				body: {
					name: "Recommended to me",
					description: "Movies recommended by friends",
					membershipPropertiesSchema: membershipSchema,
				},
				userId: "user-1",
			},
			mockDeps,
		);

		expect("data" in result).toBe(true);
		if ("data" in result) {
			expect(result.data.name).toBe("Recommended to me");
			expect(result.data.properties).toMatchObject({
				description: "Movies recommended by friends",
				membershipPropertiesSchema: membershipSchema,
			});
		}
	});

	it("creates a collection with description only", async () => {
		const result = await createCollection(
			{
				body: { name: "Test Collection", description: "A description" },
				userId: "user-1",
			},
			mockDeps,
		);

		expect("data" in result).toBe(true);
		if ("data" in result) {
			expect(result.data.properties).toEqual({ description: "A description" });
		}
	});

	it("returns validation error for empty name", async () => {
		const result = await createCollection(
			{
				body: { name: "" },
				userId: "user-1",
			},
			mockDeps,
		);

		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toBe("validation");
			expect(result.message).toContain("Collection name");
		}
	});

	it("returns not_found error when collection schema is missing", async () => {
		const depsWithoutSchema = {
			...mockDeps,
			getBuiltinCollectionSchema: async () => undefined,
		};

		const result = await createCollection(
			{
				body: { name: "Test Collection" },
				userId: "user-1",
			},
			depsWithoutSchema,
		);

		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toBe("not_found");
			expect(result.message).toContain("Collection entity schema not found");
		}
	});

	it("returns validation error for invalid membershipPropertiesSchema type", async () => {
		const result = await createCollection(
			{
				body: {
					name: "Test Collection",
					membershipPropertiesSchema: "not an object",
				} as unknown as { name: string },
				userId: "user-1",
			},
			mockDeps,
		);

		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toBe("validation");
			expect(result.message).toContain(
				"membershipPropertiesSchema must be a valid AppSchema",
			);
		}
	});

	it("returns validation error for membershipPropertiesSchema without fields", async () => {
		const result = await createCollection(
			{
				body: {
					name: "Test Collection",
					membershipPropertiesSchema: { rules: [] },
				} as unknown as { name: string },
				userId: "user-1",
			},
			mockDeps,
		);

		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toBe("validation");
			expect(result.message).toContain(
				"membershipPropertiesSchema must be a valid AppSchema",
			);
		}
	});

	it("returns validation error for membershipPropertiesSchema with invalid property type", async () => {
		const result = await createCollection(
			{
				body: {
					name: "Test Collection",
					membershipPropertiesSchema: {
						fields: {
							invalidField: { type: "invalid_type" },
						},
					},
				} as unknown as { name: string },
				userId: "user-1",
			},
			mockDeps,
		);

		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toBe("validation");
			expect(result.message).toContain(
				"membershipPropertiesSchema must be a valid AppSchema",
			);
		}
	});

	it("propagates repository errors", async () => {
		const failingDeps = {
			...mockDeps,
			createCollectionForUser: async () => {
				throw new Error("Database connection lost");
			},
		};

		expect(
			createCollection(
				{ body: { name: "Test Collection" }, userId: "user-1" },
				failingDeps,
			),
		).rejects.toThrow("Database connection lost");
	});

	describe("nested membershipPropertiesSchema validation", () => {
		it("accepts valid nested object properties", async () => {
			const nestedSchema = {
				fields: {
					friendWhoRecommendedIt: { type: "string" as const },
					recommendationDetails: {
						type: "object" as const,
						properties: {
							where: { type: "string" as const },
							when: { type: "date" as const },
							rating: { type: "integer" as const },
						},
					},
				},
			};

			const result = await createCollection(
				{
					body: {
						name: "Nested Schema Collection",
						membershipPropertiesSchema: nestedSchema,
					},
					userId: "user-1",
				},
				mockDeps,
			);

			expect("data" in result).toBe(true);
			if ("data" in result) {
				expect(result.data.properties.membershipPropertiesSchema).toEqual(
					nestedSchema,
				);
			}
		});

		it("accepts valid nested array with item schema", async () => {
			const arraySchema = {
				fields: {
					tags: {
						type: "array" as const,
						items: { type: "string" as const },
					},
				},
			};

			const result = await createCollection(
				{
					body: {
						name: "Array Schema Collection",
						membershipPropertiesSchema: arraySchema,
					},
					userId: "user-1",
				},
				mockDeps,
			);

			expect("data" in result).toBe(true);
		});

		it("returns validation error for invalid nested property type", async () => {
			const result = await createCollection(
				{
					body: {
						name: "Invalid Nested Collection",
						membershipPropertiesSchema: {
							fields: {
								nested: {
									type: "object" as const,
									properties: {
										invalidField: { type: "unknown_type" },
									},
								},
							},
						},
					} as unknown as { name: string },
					userId: "user-1",
				},
				mockDeps,
			);

			expect("error" in result).toBe(true);
			if ("error" in result) {
				expect(result.error).toBe("validation");
				expect(result.message).toContain(
					"membershipPropertiesSchema must be a valid AppSchema",
				);
			}
		});

		it("returns validation error for invalid array item type", async () => {
			const result = await createCollection(
				{
					body: {
						name: "Invalid Array Collection",
						membershipPropertiesSchema: {
							fields: {
								tags: {
									type: "array" as const,
									items: { type: "unknown_type" },
								},
							},
						},
					} as unknown as { name: string },
					userId: "user-1",
				},
				mockDeps,
			);

			expect("error" in result).toBe(true);
			if ("error" in result) {
				expect(result.error).toBe("validation");
				expect(result.message).toContain(
					"membershipPropertiesSchema must be a valid AppSchema",
				);
			}
		});

		it("accepts complex deeply nested schema with multiple levels", async () => {
			const complexSchema = {
				fields: {
					metadata: {
						type: "object" as const,
						properties: {
							source: {
								type: "object" as const,
								properties: {
									name: { type: "string" as const },
									url: { type: "string" as const },
								},
							},
							tags: {
								type: "array" as const,
								items: {
									type: "object" as const,
									properties: {
										label: { type: "string" as const },
										color: { type: "string" as const },
									},
								},
							},
						},
					},
					priority: { type: "integer" as const },
				},
			};

			const result = await createCollection(
				{
					body: {
						name: "Complex Nested Collection",
						membershipPropertiesSchema: complexSchema,
					},
					userId: "user-1",
				},
				mockDeps,
			);

			expect("data" in result).toBe(true);
			if ("data" in result) {
				expect(result.data.properties.membershipPropertiesSchema).toEqual(
					complexSchema,
				);
			}
		});

		it("does not create entity when nested template validation fails", async () => {
			let wasCreateCalled = false;

			const trackingDeps = {
				...mockDeps,
				createCollectionForUser: async (input: {
					name: string;
					userId: string;
					entitySchemaId: string;
					properties: Record<string, unknown>;
				}) => {
					wasCreateCalled = true;
					return mockDeps.createCollectionForUser(input);
				},
			};

			const result = await createCollection(
				{
					body: {
						name: "Should Not Create",
						membershipPropertiesSchema: {
							fields: {
								nested: {
									type: "object" as const,
									properties: {
										invalid: { type: "bad_type" },
									},
								},
							},
						},
					} as unknown as { name: string },
					userId: "user-1",
				},
				trackingDeps,
			);

			expect("error" in result).toBe(true);
			expect(wasCreateCalled).toBe(false);
		});
	});
});
