import { describe, expect, it } from "bun:test";
import {
	createEntityBody,
	createEntityDeps,
	createListedEntity,
	createNestedMetadataPropertiesSchema,
	createOptionalTitlePropertiesSchema,
	createRequiredTitlePropertiesSchema,
	createTitleAndPagesPropertiesSchema,
} from "~/lib/test-fixtures";
import { expectDataResult } from "~/lib/test-helpers";
import {
	createEntity,
	getEntityDetail,
	parseEntityProperties,
	resolveEntityCreateInput,
	resolveEntityId,
	resolveEntityName,
	resolveEntitySchemaId,
} from "./service";

describe("resolveEntityName", () => {
	it("trims the provided name", () => {
		expect(resolveEntityName("  My Entity  ")).toBe("My Entity");
	});

	it("throws when the name is blank", () => {
		expect(() => resolveEntityName("   ")).toThrow("Entity name is required");
	});
});

describe("resolveEntitySchemaId", () => {
	it("trims the provided entity schema id", () => {
		expect(resolveEntitySchemaId("  schema_123  ")).toBe("schema_123");
	});

	it("throws when the entity schema id is blank", () => {
		expect(() => resolveEntitySchemaId("   ")).toThrow(
			"Entity schema id is required",
		);
	});
});

describe("resolveEntityId", () => {
	it("trims the provided entity id", () => {
		expect(resolveEntityId("  entity_123  ")).toBe("entity_123");
	});

	it("throws when the entity id is blank", () => {
		expect(() => resolveEntityId("   ")).toThrow("Entity id is required");
	});
});

describe("parseEntityProperties", () => {
	it("validates properties against schema", () => {
		const propertiesSchema = createTitleAndPagesPropertiesSchema();

		const properties = { pages: 350, title: "My Book" };

		expect(
			parseEntityProperties({ properties, propertiesSchema }),
		).toMatchObject({ pages: 350, title: "My Book" });
	});

	it("accepts properties with optional fields missing", () => {
		const propertiesSchema = createTitleAndPagesPropertiesSchema();

		const properties = { title: "My Book" };

		expect(
			parseEntityProperties({ properties, propertiesSchema }),
		).toMatchObject({ title: "My Book" });
	});

	it("rejects properties missing required fields", () => {
		const propertiesSchema = createTitleAndPagesPropertiesSchema();

		const properties = { pages: 350 };

		expect(() =>
			parseEntityProperties({ properties, propertiesSchema }),
		).toThrow("Entity properties validation failed");
	});

	it("rejects properties with wrong type", () => {
		const propertiesSchema = createTitleAndPagesPropertiesSchema();

		const properties = {
			title: "My Book",
			pages: "not a number",
		};

		expect(() =>
			parseEntityProperties({ properties, propertiesSchema }),
		).toThrow("Entity properties validation failed");
	});

	it("rejects non-object properties", () => {
		const propertiesSchema = createOptionalTitlePropertiesSchema();

		expect(() =>
			parseEntityProperties({ properties: "not an object", propertiesSchema }),
		).toThrow("Entity properties must be a JSON object");
	});

	it("rejects array properties", () => {
		const propertiesSchema = createOptionalTitlePropertiesSchema();

		expect(() =>
			parseEntityProperties({ properties: [], propertiesSchema }),
		).toThrow("Entity properties must be a JSON object, not an array");
	});

	it("validates nested object properties", () => {
		const propertiesSchema = createNestedMetadataPropertiesSchema();

		const properties = {
			metadata: { year: 2024, author: "John Doe" },
		};

		expect(
			parseEntityProperties({ properties, propertiesSchema }),
		).toMatchObject(properties);
	});
});

describe("resolveEntityCreateInput", () => {
	it("returns normalized payload", () => {
		const propertiesSchema = createTitleAndPagesPropertiesSchema();

		expect(
			resolveEntityCreateInput({
				image: null,
				propertiesSchema,
				name: "  My Book  ",
				properties: { title: "Test Book", pages: 200 },
			}),
		).toEqual({
			image: null,
			name: "My Book",
			properties: { title: "Test Book", pages: 200 },
		});
	});

	it("accepts a remote image url", () => {
		const propertiesSchema = createRequiredTitlePropertiesSchema();

		expect(
			resolveEntityCreateInput({
				name: "Book",
				propertiesSchema,
				properties: { title: "Test Book" },
				image: { kind: "remote", url: "https://example.com/image.jpg" },
			}),
		).toEqual({
			name: "Book",
			properties: { title: "Test Book" },
			image: { kind: "remote", url: "https://example.com/image.jpg" },
		});
	});

	it("accepts an s3 image key", () => {
		const propertiesSchema = createRequiredTitlePropertiesSchema();

		expect(
			resolveEntityCreateInput({
				name: "Book",
				propertiesSchema,
				properties: { title: "Test Book" },
				image: { kind: "s3", key: "uploads/entities/entity-image-123" },
			}),
		).toEqual({
			name: "Book",
			properties: { title: "Test Book" },
			image: { kind: "s3", key: "uploads/entities/entity-image-123" },
		});
	});

	it("rejects invalid remote image urls", () => {
		const propertiesSchema = createRequiredTitlePropertiesSchema();

		expect(() =>
			resolveEntityCreateInput({
				name: "Book",
				propertiesSchema,
				properties: { title: "Test Book" },
				image: { kind: "remote", url: "not-a-url" },
			}),
		).toThrow("Entity image remote url must be a valid URL");
	});
});

describe("getEntityDetail", () => {
	it("returns not found when the entity does not exist", async () => {
		const result = await getEntityDetail(
			{ entityId: "entity_1", userId: "user_1" },
			createEntityDeps({ getEntityScopeForUser: async () => undefined }),
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Entity not found",
		});
	});
});

describe("createEntity", () => {
	it("normalizes the payload before persisting", async () => {
		let createdName: string | undefined;
		const deps = createEntityDeps({
			createEntityForUser: async (input) => {
				createdName = input.name;
				return createListedEntity({
					name: input.name,
					image: input.image,
					properties: input.properties,
				});
			},
		});

		const createdEntity = expectDataResult(
			await createEntity(
				{
					userId: "user_1",
					body: {
						...createEntityBody(),
						name: "  My Book  ",
						properties: { title: "My Book" },
					},
				},
				deps,
			),
		);

		expect(createdName).toBe("My Book");
		expect(createdEntity.name).toBe("My Book");
	});

	it("returns validation when the schema is built in", async () => {
		const result = await createEntity(
			{ body: createEntityBody(), userId: "user_1" },
			createEntityDeps({
				getEntitySchemaScopeForUser: async () => ({
					userId: null,
					id: "schema_1",
					isBuiltin: true,
					propertiesSchema: {},
				}),
			}),
		);

		expect(result).toEqual({
			error: "validation",
			message: "Built-in entity schemas do not support manual entity creation",
		});
	});

	it("returns validation for a blank entity schema id", async () => {
		const result = await createEntity(
			{
				userId: "user_1",
				body: { ...createEntityBody(), entitySchemaId: "   " },
			},
			createEntityDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: "Entity schema id is required",
		});
	});
});
