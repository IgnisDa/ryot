import { describe, expect, it } from "bun:test";
import {
	createEventSchemaBody,
	createEventSchemaDeps,
	createListedEventSchema,
	createNoteProgressPropertiesSchema,
} from "~/lib/test-fixtures";
import { expectDataResult } from "~/lib/test-helpers";
import {
	createEventSchema,
	listEventSchemas,
	parseEventSchemaPropertiesSchema,
	resolveEventSchemaCreateInput,
	resolveEventSchemaEntitySchemaId,
	resolveEventSchemaName,
	resolveEventSchemaSlug,
} from "./service";

describe("resolveEventSchemaName", () => {
	it("trims the provided name", () => {
		expect(resolveEventSchemaName("  Reading Progress  ")).toBe(
			"Reading Progress",
		);
	});

	it("throws when the name is blank", () => {
		expect(() => resolveEventSchemaName("   ")).toThrow(
			"Event schema name is required",
		);
	});
});

describe("resolveEventSchemaEntitySchemaId", () => {
	it("trims the provided entity schema id", () => {
		expect(resolveEventSchemaEntitySchemaId("  entity_schema_123  ")).toBe(
			"entity_schema_123",
		);
	});

	it("throws when the entity schema id is blank", () => {
		expect(() => resolveEventSchemaEntitySchemaId("   ")).toThrow(
			"Entity schema id is required",
		);
	});
});

describe("resolveEventSchemaSlug", () => {
	it("normalizes the provided slug", () => {
		expect(
			resolveEventSchemaSlug({
				name: "Reading Progress",
				slug: "  Reading_Progress  ",
			}),
		).toBe("reading-progress");
	});

	it("falls back to the name when no slug is provided", () => {
		expect(resolveEventSchemaSlug({ name: "Reading Progress" })).toBe(
			"reading-progress",
		);
	});
});

describe("parseEventSchemaPropertiesSchema", () => {
	it("accepts a valid properties schema object", () => {
		const schema = createNoteProgressPropertiesSchema();

		expect(parseEventSchemaPropertiesSchema(schema)).toEqual(schema);
	});

	it("rejects non-object roots", () => {
		expect(() => parseEventSchemaPropertiesSchema([])).toThrow(
			"Invalid input: expected object, received array",
		);
	});

	it("rejects string inputs", () => {
		expect(() =>
			parseEventSchemaPropertiesSchema('{"progress":{"type":"integer"}}'),
		).toThrow("Invalid input: expected object, received string");
	});

	it("rejects empty properties map", () => {
		expect(() => parseEventSchemaPropertiesSchema({ fields: {} })).toThrow(
			"Event schema properties must contain at least one property",
		);
	});

	it("rejects array property without items", () => {
		expect(() =>
			parseEventSchemaPropertiesSchema({
				fields: { checkpoints: { label: "Checkpoints", type: "array" } },
			}),
		).toThrow("Invalid input: expected object, received undefined");
	});
});

describe("resolveEventSchemaCreateInput", () => {
	it("returns normalized payload", () => {
		expect(
			resolveEventSchemaCreateInput({
				name: "  Reading Progress  ",
				slug: "  Reading_Progress  ",
				propertiesSchema: {
					fields: { progress: { label: "Progress", type: "integer" } },
				},
			}),
		).toEqual({
			name: "Reading Progress",
			slug: "reading-progress",
			propertiesSchema: {
				fields: { progress: { label: "Progress", type: "integer" } },
			},
		});
	});
});

describe("listEventSchemas", () => {
	it("returns not found when the entity schema does not exist", async () => {
		const result = await listEventSchemas(
			{ entitySchemaId: "schema_1", userId: "user_1" },
			createEventSchemaDeps({
				getEntitySchemaScopeForUser: async () => undefined,
			}),
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Entity schema not found",
		});
	});

	it("returns event schemas for a built-in entity schema", async () => {
		const eventSchemas = [createListedEventSchema({ slug: "backlog" })];

		const result = expectDataResult(
			await listEventSchemas(
				{ entitySchemaId: "schema_1", userId: "user_1" },
				createEventSchemaDeps({
					listEventSchemasByEntitySchemaForUser: async () => eventSchemas,
					getEntitySchemaScopeForUser: async (input) => ({
						slug: "book",
						isBuiltin: true,
						userId: input.userId,
						id: input.entitySchemaId,
					}),
				}),
			),
		);

		expect(result).toEqual(eventSchemas);
	});
});

describe("createEventSchema", () => {
	it("normalizes the payload before persisting", async () => {
		let createdSlug: string | undefined;
		const deps = createEventSchemaDeps({
			createEventSchemaForUser: async (input) => {
				createdSlug = input.slug;
				return createListedEventSchema({ slug: input.slug, name: input.name });
			},
		});

		const createdEventSchema = expectDataResult(
			await createEventSchema(
				{
					userId: "user_1",
					body: {
						...createEventSchemaBody(),
						slug: "  Reading_Progress  ",
					},
				},
				deps,
			),
		);

		expect(createdSlug).toBe("reading-progress");
		expect(createdEventSchema.slug).toBe("reading-progress");
	});

	it("returns validation for a blank entity schema id", async () => {
		const result = await createEventSchema(
			{
				userId: "user_1",
				body: { ...createEventSchemaBody(), entitySchemaId: "   " },
			},
			createEventSchemaDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: "Entity schema id is required",
		});
	});

	it("returns validation when attempting to create an event schema for a built-in entity schema", async () => {
		const result = await createEventSchema(
			{ userId: "user_1", body: createEventSchemaBody() },
			createEventSchemaDeps({
				getEntitySchemaScopeForUser: async (input) => ({
					slug: "book",
					isBuiltin: true,
					userId: input.userId,
					id: input.entitySchemaId,
				}),
			}),
		);

		expect(result).toEqual({
			error: "validation",
			message: "Built-in entity schemas do not support event schema creation",
		});
	});
});
