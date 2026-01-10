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
	getBuiltinCollectionSchemaForUser: async () => ({
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
			getBuiltinCollectionSchemaForUser: async () => undefined,
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
			expect(result.message).toContain("Invalid property definition");
		}
	});
});
