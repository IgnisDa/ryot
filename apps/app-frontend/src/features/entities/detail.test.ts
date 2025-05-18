import { describe, expect, it } from "bun:test";
import { getEntityDetailProperties } from "./detail";
import type { AppEntity } from "./model";

function createEntityFixture(overrides: Partial<AppEntity> = {}): AppEntity {
	return {
		image: null,
		id: "entity-1",
		properties: {},
		externalId: null,
		name: "Morning Run",
		entitySchemaId: "schema-1",
		detailsSandboxScriptId: null,
		createdAt: new Date("2026-03-08T08:00:00.000Z"),
		updatedAt: new Date("2026-03-08T08:30:00.000Z"),
		...overrides,
	};
}

describe("getEntityDetailProperties", () => {
	it("formats primitive schema properties in schema order", () => {
		const entity = createEntityFixture({
			properties: {
				completed: true,
				distanceKm: 5.25,
				notes: "Easy pace",
				startedOn: "2026-03-08",
				ignored: "not in schema",
			},
		});

		const properties = getEntityDetailProperties(
			{
				notes: { type: "string" },
				completed: { type: "boolean" },
				startedOn: { type: "date" },
				distanceKm: { type: "number" },
			},
			entity.properties,
		);

		expect(properties).toEqual([
			{
				key: "notes",
				type: "string",
				label: "notes",
				value: "Easy pace",
				rawValue: "Easy pace",
			},
			{
				key: "completed",
				type: "boolean",
				label: "completed",
				value: "Yes",
				rawValue: true,
			},
			{
				key: "startedOn",
				type: "date",
				label: "startedOn",
				value: "March 8, 2026",
				rawValue: "2026-03-08",
			},
			{
				key: "distanceKm",
				type: "number",
				label: "distanceKm",
				value: "5.25",
				rawValue: 5.25,
			},
		]);
	});

	it("includes array and object properties with basic formatting", () => {
		const entity = createEntityFixture({
			properties: {
				mood: "strong",
				tags: ["tempo", "morning"],
				metadata: { source: "watch", version: "2.0" },
			},
		});

		const properties = getEntityDetailProperties(
			{
				tags: { type: "array", items: { type: "string" } },
				mood: { type: "string" },
				metadata: {
					type: "object",
					properties: { source: { type: "string" } },
				},
			},
			entity.properties,
		);

		expect(properties.length).toBe(3);
		expect(properties[0]).toEqual({
			key: "tags",
			type: "array",
			label: "tags",
			value: "tempo, morning",
			rawValue: ["tempo", "morning"],
		});
		expect(properties[1]).toEqual({
			key: "mood",
			type: "string",
			label: "mood",
			value: "strong",
			rawValue: "strong",
		});
		expect(properties[2]).toEqual({
			key: "metadata",
			type: "object",
			label: "metadata",
			value: "source: watch, version: 2.0",
			rawValue: { source: "watch", version: "2.0" },
		});
	});
});
