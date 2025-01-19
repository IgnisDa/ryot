import { describe, expect, it } from "bun:test";
import type { AppEventSchema } from "../event-schemas/model";
import {
	buildCreateEventFormSchema,
	buildDefaultEventFormValues,
	formatOccurredAtInputValue,
	getSelectedEventSchema,
	getUnsupportedRequiredEventProperties,
	normalizeOccurredAtInputValue,
	reconcileEventProperties,
	toCreateEventPayload,
} from "./form";

function createEventSchemaFixture(
	overrides: Partial<AppEventSchema> = {},
): AppEventSchema {
	return {
		id: "schema-1",
		name: "Reading",
		slug: "reading",
		entitySchemaId: "entity-schema-1",
		propertiesSchema: {
			pages: { type: "integer", required: true },
			notes: { type: "string" },
		},
		...overrides,
	};
}

describe("buildDefaultEventFormValues", () => {
	it("uses the current timestamp, first schema selection, and generated defaults", () => {
		const now = new Date(2026, 2, 8, 10, 15, 0, 0);
		const values = buildDefaultEventFormValues(
			[
				createEventSchemaFixture({
					id: "schema-1",
					propertiesSchema: {
						notes: { type: "string" },
						pages: { type: "integer", required: true },
					},
				}),
				createEventSchemaFixture({ id: "schema-2", name: "Finished" }),
			],
			now,
		);

		expect(values.eventSchemaId).toBe("schema-1");
		expect(values.occurredAt).toBe("2026-03-08T10:15");
		expect(values.properties).toEqual({ pages: 0 });
	});

	it("uses the requested schema id when generating defaults", () => {
		const now = new Date(2026, 2, 8, 10, 15, 0, 0);
		const values = buildDefaultEventFormValues(
			[
				createEventSchemaFixture({
					id: "schema-1",
					propertiesSchema: { pages: { type: "integer", required: true } },
				}),
				createEventSchemaFixture({
					id: "schema-2",
					name: "Finished",
					propertiesSchema: { completed: { type: "boolean", required: true } },
				}),
			],
			now,
			"schema-2",
		);

		expect(values.eventSchemaId).toBe("schema-2");
		expect(values.properties).toEqual({ completed: false });
	});

	it("falls back to the first schema when the requested schema id is invalid", () => {
		const now = new Date(2026, 2, 8, 10, 15, 0, 0);
		const values = buildDefaultEventFormValues(
			[
				createEventSchemaFixture({
					id: "schema-1",
					propertiesSchema: { pages: { type: "integer", required: true } },
				}),
				createEventSchemaFixture({
					id: "schema-2",
					name: "Finished",
					propertiesSchema: { completed: { type: "boolean", required: true } },
				}),
			],
			now,
			"missing-schema",
		);

		expect(values.eventSchemaId).toBe("schema-1");
		expect(values.properties).toEqual({ pages: 0 });
	});

	it("skips non-primitive generated defaults", () => {
		const now = new Date(2026, 2, 8, 10, 15, 0, 0);
		const values = buildDefaultEventFormValues(
			[
				createEventSchemaFixture({
					propertiesSchema: {
						pages: { type: "integer", required: true },
						tags: {
							type: "array",
							required: true,
							items: { type: "string" },
						},
						metadata: {
							type: "object",
							required: true,
							properties: { rating: { type: "number", required: true } },
						},
					},
				}),
			],
			now,
		);

		expect(values.properties).toEqual({ pages: 0 });
	});
});

describe("buildCreateEventFormSchema", () => {
	it("requires a schema selection", () => {
		const schema = buildCreateEventFormSchema();
		const result = schema.safeParse({
			properties: {},
			eventSchemaId: "  \n\t ",
			occurredAt: "2026-03-08T10:15:00.000Z",
		});

		expect(result.success).toBeFalse();
	});

	it("validates generated properties against the selected event schema", () => {
		const schema = buildCreateEventFormSchema([
			createEventSchemaFixture({
				id: "schema-1",
				propertiesSchema: {
					minutes: { type: "number" },
					completed: { type: "boolean", required: true },
				},
			}),
		]);
		const result = schema.safeParse({
			eventSchemaId: "schema-1",
			occurredAt: "2026-03-08T10:15:00.000Z",
			properties: { completed: true, minutes: "15" },
		});

		expect(result.success).toBeFalse();
	});

	it("switches validation based on the submitted schema id", () => {
		const schema = buildCreateEventFormSchema([
			createEventSchemaFixture({
				id: "schema-1",
				propertiesSchema: { pages: { type: "integer", required: true } },
			}),
			createEventSchemaFixture({
				id: "schema-2",
				name: "Finished",
				propertiesSchema: { completed: { type: "boolean", required: true } },
			}),
		]);

		const oldSchemaResult = schema.safeParse({
			eventSchemaId: "schema-1",
			occurredAt: "2026-03-08T10:15:00.000Z",
			properties: { completed: true },
		});
		const newSchemaResult = schema.safeParse({
			eventSchemaId: "schema-2",
			properties: { completed: true },
			occurredAt: "2026-03-08T10:15:00.000Z",
		});

		expect(oldSchemaResult.success).toBeFalse();
		expect(newSchemaResult.success).toBeTrue();
	});

	it("blocks schemas with required unsupported properties with a clear issue", () => {
		const schema = buildCreateEventFormSchema([
			createEventSchemaFixture({
				propertiesSchema: {
					pages: { type: "integer", required: true },
					tags: {
						type: "array",
						required: true,
						items: { type: "string" },
					},
					metadata: {
						type: "object",
						required: true,
						properties: { rating: { type: "number", required: true } },
					},
				},
			}),
		]);
		const result = schema.safeParse({
			properties: { pages: 10 },
			eventSchemaId: "schema-1",
			occurredAt: "2026-03-08T10:15",
		});

		expect(result.success).toBeFalse();
		if (result.success) throw new Error("Expected validation failure");

		expect(result.error.issues).toContainEqual(
			expect.objectContaining({
				path: ["properties"],
				message:
					"This event schema cannot be logged here yet because it requires unsupported properties: tags, metadata.",
			}),
		);
	});
});

describe("getUnsupportedRequiredEventProperties", () => {
	it("returns only required unsupported property keys", () => {
		expect(
			getUnsupportedRequiredEventProperties({
				pages: { type: "integer", required: true },
				notes: { type: "array", items: { type: "string" } },
				tags: { type: "array", required: true, items: { type: "string" } },
				metadata: {
					type: "object",
					required: true,
					properties: { rating: { type: "number", required: true } },
				},
			}),
		).toEqual(["tags", "metadata"]);
	});
});

describe("getSelectedEventSchema", () => {
	it("falls back to the first schema when the current selection is invalid", () => {
		const eventSchemas = [
			createEventSchemaFixture({ id: "schema-1" }),
			createEventSchemaFixture({ id: "schema-2", name: "Finished" }),
		];

		expect(getSelectedEventSchema(eventSchemas, "missing-schema")?.id).toBe(
			"schema-1",
		);
	});
});

describe("toCreateEventPayload", () => {
	it("normalizes a datetime-local occurredAt value to iso before submit", () => {
		const payload = toCreateEventPayload(
			{
				eventSchemaId: "schema-1",
				occurredAt: "2026-03-08T10:15",
				properties: { completed: true },
			},
			"entity-1",
		);

		expect(payload.occurredAt).toBe(new Date("2026-03-08T10:15").toISOString());
	});

	it("trims ids and preserves validated properties", () => {
		const payload = toCreateEventPayload(
			{
				eventSchemaId: "  schema-1  ",
				occurredAt: "2026-03-08T10:15:00.000Z",
				properties: { completed: true, minutes: 15 },
			},
			"  entity-1  ",
		);

		expect(payload).toEqual({
			entityId: "entity-1",
			eventSchemaId: "schema-1",
			occurredAt: "2026-03-08T10:15:00.000Z",
			properties: { completed: true, minutes: 15 },
		});
	});

	it("drops stale properties after the schema selection changes", () => {
		const payload = toCreateEventPayload(
			{
				eventSchemaId: "schema-2",
				occurredAt: "2026-03-08T10:15:00.000Z",
				properties: { minutes: 15, completed: true },
			},
			"entity-1",
			[
				createEventSchemaFixture({
					id: "schema-1",
					propertiesSchema: { minutes: { type: "number", required: true } },
				}),
				createEventSchemaFixture({
					id: "schema-2",
					name: "Finished",
					propertiesSchema: { completed: { type: "boolean", required: true } },
				}),
			],
		);

		expect(payload.properties).toEqual({ completed: true });
	});

	it("sanitizes unknown properties using the selected schema", () => {
		const payload = toCreateEventPayload(
			{
				eventSchemaId: "schema-1",
				occurredAt: "2026-03-08T10:15:00.000Z",
				properties: { minutes: 15, extra: "ignore-me" },
			},
			"entity-1",
			[
				createEventSchemaFixture({
					id: "schema-1",
					propertiesSchema: { minutes: { type: "number", required: true } },
				}),
			],
		);

		expect(payload.properties).toEqual({ minutes: 15 });
	});
});

describe("occurredAt input helpers", () => {
	it("formats an iso timestamp for datetime-local inputs", () => {
		expect(
			formatOccurredAtInputValue(
				new Date(2026, 2, 8, 10, 15, 0, 0).toISOString(),
			),
		).toBe("2026-03-08T10:15");
	});

	it("preserves a datetime-local value without re-normalizing it", () => {
		expect(formatOccurredAtInputValue("2026-03-08T10:15")).toBe(
			"2026-03-08T10:15",
		);
	});

	it("normalizes datetime-local inputs back to iso timestamps", () => {
		expect(normalizeOccurredAtInputValue("2026-03-08T10:15")).toBe(
			new Date("2026-03-08T10:15").toISOString(),
		);
	});

	it("returns an empty string for partial datetime-local input", () => {
		expect(normalizeOccurredAtInputValue("2026-03-08T10:")).toBe("");
	});

	it("returns an empty string for invalid datetime-local input", () => {
		expect(normalizeOccurredAtInputValue("not-a-date")).toBe("");
	});
});

describe("reconcileEventProperties", () => {
	it("preserves compatible values, resets missing required defaults, and drops stale keys", () => {
		expect(
			reconcileEventProperties(
				{
					notes: { type: "string" },
					pages: { type: "integer", required: true },
					completed: { type: "boolean", required: true },
				},
				{
					pages: 42,
					minutes: 15,
					completed: "yes",
					notes: "keep me",
				},
			),
		).toEqual({
			pages: 42,
			completed: false,
			notes: "keep me",
		});
	});

	it("skips unsupported properties while keeping supported values", () => {
		expect(
			reconcileEventProperties(
				{
					pages: { type: "integer", required: true },
					tags: {
						type: "array",
						required: true,
						items: { type: "string" },
					},
				},
				{ pages: 12, tags: ["a"] },
			),
		).toEqual({ pages: 12 });
	});
});
