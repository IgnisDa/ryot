import { describe, expect, it } from "bun:test";
import type { CreateEntityBody, ListedEntity } from "./schemas";
import {
	createEntity,
	type EntityServiceDeps,
	type EntityServiceResult,
	getEntityDetail,
	parseEntityProperties,
	resolveEntityCreateInput,
	resolveEntityId,
	resolveEntityName,
	resolveEntitySchemaId,
} from "./service";

const createEntityBody = (): CreateEntityBody => ({
	image: null,
	name: "My Book",
	entitySchemaId: "schema_1",
	properties: { title: "My Book" },
});

const createListedEntity = (
	overrides: Partial<ListedEntity> = {},
): ListedEntity => ({
	image: null,
	id: "entity_1",
	name: "My Book",
	externalId: null,
	entitySchemaId: "schema_1",
	detailsSandboxScriptId: null,
	properties: { title: "My Book" },
	createdAt: new Date("2024-01-01T00:00:00.000Z"),
	updatedAt: new Date("2024-01-01T00:00:00.000Z"),
	...overrides,
});

const createDeps = (
	overrides: Partial<EntityServiceDeps> = {},
): EntityServiceDeps => ({
	createEntityForUser: async (input) =>
		createListedEntity({
			name: input.name,
			image: input.image,
			properties: input.properties,
			entitySchemaId: input.entitySchemaId,
		}),
	getEntityByIdForUser: async (input) =>
		createListedEntity({ id: input.entityId }),
	getEntitySchemaScopeForUser: async (input) => ({
		isBuiltin: false,
		userId: input.userId,
		id: input.entitySchemaId,
		propertiesSchema: { title: { type: "string" as const, required: true } },
	}),
	getEntityScopeForUser: async (input) => ({
		isBuiltin: false,
		entityId: input.entityId,
		entitySchemaId: "schema_1",
	}),
	...overrides,
});

const expectDataResult = <T>(result: EntityServiceResult<T>) => {
	if ("error" in result) {
		throw new Error(`Expected data result, got ${result.error}`);
	}

	return result.data;
};

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
		const propertiesSchema = {
			pages: { type: "integer" as const },
			title: { type: "string" as const, required: true as const },
		};

		const properties = { pages: 350, title: "My Book" };

		expect(
			parseEntityProperties({ properties, propertiesSchema }),
		).toMatchObject({ pages: 350, title: "My Book" });
	});

	it("accepts properties with optional fields missing", () => {
		const propertiesSchema = {
			pages: { type: "integer" as const },
			title: { type: "string" as const, required: true as const },
		};

		const properties = { title: "My Book" };

		expect(
			parseEntityProperties({ properties, propertiesSchema }),
		).toMatchObject({ title: "My Book" });
	});

	it("rejects properties missing required fields", () => {
		const propertiesSchema = {
			pages: { type: "integer" as const },
			title: { type: "string" as const, required: true as const },
		};

		const properties = { pages: 350 };

		expect(() =>
			parseEntityProperties({ properties, propertiesSchema }),
		).toThrow("Entity properties validation failed");
	});

	it("rejects properties with wrong type", () => {
		const propertiesSchema = {
			title: { type: "string" as const, required: true as const },
			pages: { type: "integer" as const },
		};

		const properties = {
			title: "My Book",
			pages: "not a number",
		};

		expect(() =>
			parseEntityProperties({ properties, propertiesSchema }),
		).toThrow("Entity properties validation failed");
	});

	it("rejects non-object properties", () => {
		const propertiesSchema = {
			title: { type: "string" as const },
		};

		expect(() =>
			parseEntityProperties({ properties: "not an object", propertiesSchema }),
		).toThrow("Entity properties must be a JSON object");
	});

	it("rejects array properties", () => {
		const propertiesSchema = {
			title: { type: "string" as const },
		};

		expect(() =>
			parseEntityProperties({ properties: [], propertiesSchema }),
		).toThrow("Entity properties must be a JSON object, not an array");
	});

	it("validates nested object properties", () => {
		const propertiesSchema = {
			metadata: {
				type: "object" as const,
				properties: {
					year: { type: "integer" as const },
					author: { type: "string" as const },
				},
			},
		};

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
		const propertiesSchema = {
			pages: { type: "integer" as const },
			title: { type: "string" as const, required: true as const },
		};

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
		const propertiesSchema = {
			title: { type: "string" as const, required: true as const },
		};

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
		const propertiesSchema = {
			title: { type: "string" as const, required: true as const },
		};

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
		const propertiesSchema = {
			title: { type: "string" as const, required: true as const },
		};

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
			createDeps({ getEntityScopeForUser: async () => undefined }),
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
		const deps = createDeps({
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
			createDeps({
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
			createDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: "Entity schema id is required",
		});
	});
});
