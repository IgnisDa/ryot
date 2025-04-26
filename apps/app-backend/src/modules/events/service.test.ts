import { describe, expect, it } from "bun:test";
import {
	parseEventProperties,
	resolveEventCreateInput,
	resolveEventEntityId,
	resolveEventSchemaId,
	resolveOccurredAt,
} from "./service";

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
