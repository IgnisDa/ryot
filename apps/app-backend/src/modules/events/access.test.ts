import { describe, expect, it } from "bun:test";
import { createEventCreateScope } from "~/lib/test-fixtures";
import { resolveEventCreateAccess } from "./service";

describe("resolveEventCreateAccess", () => {
	it("returns not_found when the entity scope is undefined", () => {
		expect(resolveEventCreateAccess(undefined)).toEqual({ error: "not_found" });
	});

	it("returns event_schema_not_found when the event schema is missing", () => {
		expect(
			resolveEventCreateAccess({
				isBuiltin: false,
				eventSchemaId: null,
				entityId: "entity-1",
				eventSchemaSlug: null,
				eventSchemaName: null,
				propertiesSchema: null,
				entitySchemaId: "schema-1",
				eventSchemaEntitySchemaId: null,
			}),
		).toEqual({ error: "event_schema_not_found" });
	});

	it("returns event_schema_mismatch when the event schema belongs elsewhere", () => {
		expect(
			resolveEventCreateAccess(
				createEventCreateScope({ eventSchemaEntitySchemaId: "schema-2" }),
			),
		).toEqual({ error: "event_schema_mismatch" });
	});

	it("allows built-in entity schemas when the event schema matches", () => {
		expect(
			resolveEventCreateAccess(
				createEventCreateScope({
					isBuiltin: true,
					propertiesSchema: {},
					eventSchemaSlug: "backlog",
					eventSchemaName: "Backlog",
				}),
			),
		).toEqual({
			access: {
				entityId: "entity_1",
				propertiesSchema: {},
				eventSchemaSlug: "backlog",
				eventSchemaName: "Backlog",
				entitySchemaId: "schema_1",
				eventSchemaId: "event_schema_1",
			},
		});
	});

	it("returns the resolved scope when the event schema matches", () => {
		const scope = createEventCreateScope({
			entityId: "entity-1",
			eventSchemaSlug: "log",
			eventSchemaName: "Log",
			entitySchemaId: "schema-1",
			eventSchemaId: "event-schema-1",
			eventSchemaEntitySchemaId: "schema-1",
			propertiesSchema: { rating: { type: "number" as const } },
		});

		expect(resolveEventCreateAccess(scope)).toEqual({
			access: {
				entityId: "entity-1",
				eventSchemaSlug: "log",
				eventSchemaName: "Log",
				entitySchemaId: "schema-1",
				eventSchemaId: "event-schema-1",
				propertiesSchema: { rating: { type: "number" } },
			},
		});
	});
});
