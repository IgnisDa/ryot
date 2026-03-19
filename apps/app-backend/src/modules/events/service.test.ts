import { describe, expect, it } from "bun:test";
import type { CreateEventBody, ListedEvent } from "./schemas";
import {
	createEvent,
	type EventServiceDeps,
	type EventServiceResult,
	listEntityEvents,
	parseEventProperties,
	resolveEventCreateInput,
	resolveEventEntityId,
	resolveEventSchemaId,
	resolveOccurredAt,
} from "./service";

const createEventBody = (): CreateEventBody => ({
	entityId: "entity_1",
	eventSchemaId: "event_schema_1",
	occurredAt: "2026-03-08T10:15:00.000Z",
	properties: { rating: 4 },
});

const createListedEvent = (
	overrides: Partial<ListedEvent> = {},
): ListedEvent => ({
	id: "event_1",
	entityId: "entity_1",
	properties: { rating: 4 },
	eventSchemaSlug: "finished",
	eventSchemaName: "Finished",
	eventSchemaId: "event_schema_1",
	createdAt: new Date("2024-01-01T00:00:00.000Z"),
	updatedAt: new Date("2024-01-01T00:00:00.000Z"),
	occurredAt: new Date("2026-03-08T10:15:00.000Z"),
	...overrides,
});

const createDeps = (
	overrides: Partial<EventServiceDeps> = {},
): EventServiceDeps => ({
	createEventForUser: async (input) =>
		createListedEvent({
			entityId: input.entityId,
			occurredAt: input.occurredAt,
			properties: input.properties,
			eventSchemaId: input.eventSchemaId,
			eventSchemaName: input.eventSchemaName,
			eventSchemaSlug: input.eventSchemaSlug,
		}),
	getEntityScopeForUser: async (input) => ({
		isBuiltin: false,
		entityId: input.entityId,
		entitySchemaId: "schema_1",
	}),
	getEventCreateScopeForUser: async (input) => ({
		isBuiltin: false,
		entityId: input.entityId,
		entitySchemaId: "schema_1",
		eventSchemaSlug: "finished",
		eventSchemaName: "Finished",
		eventSchemaId: input.eventSchemaId,
		eventSchemaEntitySchemaId: "schema_1",
		propertiesSchema: { rating: { type: "number" as const, required: true } },
	}),
	listEventsByEntityForUser: async () => [createListedEvent()],
	...overrides,
});

const expectDataResult = <T>(result: EventServiceResult<T>) => {
	if ("error" in result) {
		throw new Error(`Expected data result, got ${result.error}`);
	}

	return result.data;
};

describe("resolveEventEntityId", () => {
	it("trims the provided entity id", () => {
		expect(resolveEventEntityId("  entity_123  ")).toBe("entity_123");
	});

	it("throws when the entity id is blank", () => {
		expect(() => resolveEventEntityId("   ")).toThrow("Entity id is required");
	});
});

describe("resolveEventSchemaId", () => {
	it("trims the provided event schema id", () => {
		expect(resolveEventSchemaId("  event_schema_123  ")).toBe(
			"event_schema_123",
		);
	});

	it("throws when the event schema id is blank", () => {
		expect(() => resolveEventSchemaId("   ")).toThrow(
			"Event schema id is required",
		);
	});
});

describe("resolveOccurredAt", () => {
	it("parses a valid occurred at timestamp", () => {
		const occurredAt = resolveOccurredAt(" 2026-03-08T10:15:00.000Z ");

		expect(occurredAt).toBeInstanceOf(Date);
		expect(occurredAt.toISOString()).toBe("2026-03-08T10:15:00.000Z");
	});

	it("throws when occurred at is invalid", () => {
		expect(() => resolveOccurredAt("not-a-date")).toThrow(
			"Occurred at must be a valid datetime",
		);
	});

	it("throws when occurred at is not an ISO datetime string", () => {
		expect(() => resolveOccurredAt("2026-03-08")).toThrow(
			"Occurred at must be a valid datetime",
		);
	});

	it("throws when occurred at is a Date instance", () => {
		expect(() =>
			resolveOccurredAt(new Date("2026-03-08T10:15:00.000Z")),
		).toThrow("Occurred at must be a valid datetime");
	});
});

describe("parseEventProperties", () => {
	it("validates properties against schema", () => {
		const propertiesSchema = {
			note: { type: "string" as const },
			rating: { type: "number" as const, required: true as const },
		};

		expect(
			parseEventProperties({
				propertiesSchema,
				properties: { note: "Great tasting", rating: 4.5 },
			}),
		).toEqual({ note: "Great tasting", rating: 4.5 });
	});

	it("accepts optional fields missing", () => {
		const propertiesSchema = {
			note: { type: "string" as const },
			rating: { type: "number" as const, required: true as const },
		};

		expect(
			parseEventProperties({
				propertiesSchema,
				properties: { rating: 5 },
			}),
		).toEqual({ rating: 5 });
	});

	it("rejects missing required fields", () => {
		const propertiesSchema = {
			note: { type: "string" as const },
			rating: { type: "number" as const, required: true as const },
		};

		expect(() =>
			parseEventProperties({
				propertiesSchema,
				properties: { note: "Missing rating" },
			}),
		).toThrow("Event properties validation failed");
	});

	it("rejects wrong property types", () => {
		const propertiesSchema = {
			rating: { type: "number" as const, required: true as const },
		};

		expect(() =>
			parseEventProperties({
				propertiesSchema,
				properties: { rating: "bad" },
			}),
		).toThrow("Event properties validation failed");
	});

	it("rejects non-object properties", () => {
		expect(() =>
			parseEventProperties({
				properties: "bad",
				propertiesSchema: { rating: { type: "number" as const } },
			}),
		).toThrow("Event properties must be a JSON object");
	});

	it("rejects array properties", () => {
		expect(() =>
			parseEventProperties({
				properties: [],
				propertiesSchema: { rating: { type: "number" as const } },
			}),
		).toThrow("Event properties must be a JSON object, not an array");
	});
});

describe("resolveEventCreateInput", () => {
	it("returns normalized payload", () => {
		const propertiesSchema = {
			note: { type: "string" as const },
			rating: { type: "number" as const, required: true as const },
		};

		const input = resolveEventCreateInput({
			propertiesSchema,
			entityId: "  entity_123  ",
			eventSchemaId: "  event_schema_123  ",
			properties: { note: "Nice", rating: 4 },
			occurredAt: " 2026-03-08T10:15:00.000Z ",
		});

		expect(input.entityId).toBe("entity_123");
		expect(input.eventSchemaId).toBe("event_schema_123");
		expect(input.occurredAt.toISOString()).toBe("2026-03-08T10:15:00.000Z");
		expect(input.properties).toEqual({ note: "Nice", rating: 4 });
	});
});

describe("listEntityEvents", () => {
	it("returns not found when the entity does not exist", async () => {
		const result = await listEntityEvents(
			{ entityId: "entity_1", userId: "user_1" },
			createDeps({ getEntityScopeForUser: async () => undefined }),
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Entity not found",
		});
	});
});

describe("createEvent", () => {
	it("normalizes event payload before persisting", async () => {
		let createdOccurredAt: Date | undefined;
		const deps = createDeps({
			createEventForUser: async (input) => {
				createdOccurredAt = input.occurredAt;
				return createListedEvent({
					occurredAt: input.occurredAt,
					properties: input.properties,
				});
			},
		});

		const createdEvent = expectDataResult(
			await createEvent(
				{
					userId: "user_1",
					body: {
						...createEventBody(),
						occurredAt: " 2026-03-08T10:15:00.000Z ",
					},
				},
				deps,
			),
		);

		expect(createdOccurredAt?.toISOString()).toBe("2026-03-08T10:15:00.000Z");
		expect(createdEvent.occurredAt.toISOString()).toBe(
			"2026-03-08T10:15:00.000Z",
		);
	});

	it("returns validation when the event schema belongs to another entity schema", async () => {
		const result = await createEvent(
			{ body: createEventBody(), userId: "user_1" },
			createDeps({
				getEventCreateScopeForUser: async (input) => ({
					isBuiltin: false,
					entityId: input.entityId,
					entitySchemaId: "schema_1",
					eventSchemaSlug: "finished",
					eventSchemaName: "Finished",
					eventSchemaId: input.eventSchemaId,
					eventSchemaEntitySchemaId: "schema_2",
					propertiesSchema: {
						rating: { type: "number" as const, required: true },
					},
				}),
			}),
		);

		expect(result).toEqual({
			error: "validation",
			message: "Event schema does not belong to the entity schema",
		});
	});

	it("returns validation for a blank entity id", async () => {
		const result = await createEvent(
			{
				userId: "user_1",
				body: { ...createEventBody(), entityId: "   " },
			},
			createDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: "Entity id is required",
		});
	});
});
