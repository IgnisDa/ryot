import { describe, expect, it } from "bun:test";
import { resolveEventCreateAccess } from "./service";

describe("resolveEventCreateAccess", () => {
	it("returns not_found when the entity scope is undefined", () => {
		expect(resolveEventCreateAccess(undefined)).toEqual({ error: "not_found" });
	});

	it("returns builtin when the entity schema is built in", () => {
		expect(
			resolveEventCreateAccess({
				isBuiltin: true,
				entityId: "entity-1",
				propertiesSchema: {},
				eventSchemaSlug: "log",
				eventSchemaName: "Log",
				entitySchemaId: "schema-1",
				eventSchemaId: "event-schema-1",
				eventSchemaEntitySchemaId: "schema-1",
			}),
		).toEqual({ error: "builtin" });
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
			resolveEventCreateAccess({
				isBuiltin: false,
				entityId: "entity-1",
				propertiesSchema: {},
				eventSchemaSlug: "log",
				eventSchemaName: "Log",
				entitySchemaId: "schema-1",
				eventSchemaId: "event-schema-1",
				eventSchemaEntitySchemaId: "schema-2",
			}),
		).toEqual({ error: "event_schema_mismatch" });
	});

	it("returns the resolved scope when the event schema matches", () => {
		const scope = {
			isBuiltin: false,
			entityId: "entity-1",
			eventSchemaSlug: "log",
			eventSchemaName: "Log",
			entitySchemaId: "schema-1",
			eventSchemaId: "event-schema-1",
			eventSchemaEntitySchemaId: "schema-1",
			propertiesSchema: { rating: { type: "number" as const } },
		};

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
