import { describe, expect, it } from "bun:test";
import { expectDataResult } from "~/lib/test-helpers";
import type { CreateEventSchemaBody, ListedEventSchema } from "./schemas";
import {
	createEventSchema,
	type EventSchemaServiceDeps,
	listEventSchemas,
	parseEventSchemaPropertiesSchema,
	resolveEventSchemaCreateInput,
	resolveEventSchemaEntitySchemaId,
	resolveEventSchemaName,
	resolveEventSchemaSlug,
} from "./service";

const createEventSchemaBody = (): CreateEventSchemaBody => ({
	name: "Finished",
	entitySchemaId: "schema_1",
	propertiesSchema: { rating: { type: "number" } },
});

const createListedEventSchema = (
	overrides: Partial<ListedEventSchema> = {},
): ListedEventSchema => ({
	name: "Finished",
	slug: "finished",
	id: "event_schema_1",
	entitySchemaId: "schema_1",
	propertiesSchema: { rating: { type: "number" } },
	...overrides,
});

const createDeps = (
	overrides: Partial<EventSchemaServiceDeps> = {},
): EventSchemaServiceDeps => ({
	createEventSchemaForUser: async (input) =>
		createListedEventSchema({
			name: input.name,
			slug: input.slug,
			entitySchemaId: input.entitySchemaId,
			propertiesSchema: input.propertiesSchema,
		}),
	getEntitySchemaScopeForUser: async (input) => ({
		id: input.entitySchemaId,
		userId: input.userId,
		isBuiltin: false,
	}),
	getEventSchemaBySlugForUser: async () => undefined,
	listEventSchemasByEntitySchemaForUser: async () => [
		createListedEventSchema(),
	],
	...overrides,
});

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
	it("accepts flat properties map", () => {
		expect(
			parseEventSchemaPropertiesSchema({
				note: { type: "string" },
				progress: { type: "integer" },
			}),
		).toEqual({
			note: { type: "string" },
			progress: { type: "integer" },
		});
	});

	it("accepts already-parsed properties map", () => {
		const schema = {
			note: { type: "string" as const },
			progress: { type: "integer" as const },
		};

		expect(parseEventSchemaPropertiesSchema(schema)).toEqual(schema);
	});

	it("rejects non-object roots", () => {
		expect(() => parseEventSchemaPropertiesSchema([])).toThrow(
			"Invalid input: expected record, received array",
		);
	});

	it("rejects string inputs", () => {
		expect(() =>
			parseEventSchemaPropertiesSchema('{"progress":{"type":"integer"}}'),
		).toThrow("Invalid input: expected record, received string");
	});

	it("rejects empty properties map", () => {
		expect(() => parseEventSchemaPropertiesSchema({})).toThrow(
			"Event schema properties must contain at least one property",
		);
	});

	it("rejects array property without items", () => {
		expect(() =>
			parseEventSchemaPropertiesSchema({ checkpoints: { type: "array" } }),
		).toThrow("Invalid input: expected object, received undefined");
	});
});

describe("resolveEventSchemaCreateInput", () => {
	it("returns normalized payload", () => {
		expect(
			resolveEventSchemaCreateInput({
				name: "  Reading Progress  ",
				slug: "  Reading_Progress  ",
				propertiesSchema: { progress: { type: "integer" } },
			}),
		).toEqual({
			name: "Reading Progress",
			slug: "reading-progress",
			propertiesSchema: { progress: { type: "integer" } },
		});
	});
});

describe("listEventSchemas", () => {
	it("returns not found when the entity schema does not exist", async () => {
		const result = await listEventSchemas(
			{ entitySchemaId: "schema_1", userId: "user_1" },
			createDeps({ getEntitySchemaScopeForUser: async () => undefined }),
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Entity schema not found",
		});
	});
});

describe("createEventSchema", () => {
	it("normalizes the payload before persisting", async () => {
		let createdSlug: string | undefined;
		const deps = createDeps({
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

	it("returns validation when the entity schema is built in", async () => {
		const result = await createEventSchema(
			{ body: createEventSchemaBody(), userId: "user_1" },
			createDeps({
				getEntitySchemaScopeForUser: async () => ({
					userId: null,
					id: "schema_1",
					isBuiltin: true,
				}),
			}),
		);

		expect(result).toEqual({
			error: "validation",
			message: "Built-in entity schemas do not support event schemas",
		});
	});

	it("returns validation for a blank entity schema id", async () => {
		const result = await createEventSchema(
			{
				userId: "user_1",
				body: { ...createEventSchemaBody(), entitySchemaId: "   " },
			},
			createDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: "Entity schema id is required",
		});
	});
});
