import { describe, expect, it } from "bun:test";
import {
	getEntityDetailPath,
	getEntityDetailProperties,
	hasDeferredEntityDetailProperties,
} from "./detail";
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

describe("getEntityDetailPath", () => {
	it("builds the generated tracking detail route path", () => {
		expect(getEntityDetailPath("workouts", "entity-42")).toBe(
			"/tracking/workouts/entities/entity-42",
		);
	});
});

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
			{ key: "notes", label: "notes", value: "Easy pace" },
			{ key: "completed", label: "completed", value: "Yes" },
			{ key: "startedOn", label: "startedOn", value: "2026-03-08" },
			{ key: "distanceKm", label: "distanceKm", value: "5.25" },
		]);
	});

	it("skips unsupported object and array properties", () => {
		const entity = createEntityFixture({
			properties: {
				mood: "strong",
				tags: ["tempo"],
				metadata: { source: "watch" },
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

		expect(properties).toEqual([
			{ key: "mood", label: "mood", value: "strong" },
		]);
	});

	it("reports when unsupported relationship-style properties were deferred", () => {
		expect(
			hasDeferredEntityDetailProperties({
				mood: { type: "string" },
				tags: { type: "array", items: { type: "string" } },
				metadata: {
					type: "object",
					properties: { source: { type: "string" } },
				},
			}),
		).toBe(true);

		expect(
			hasDeferredEntityDetailProperties({
				mood: { type: "string" },
				completed: { type: "boolean" },
			}),
		).toBe(false);
	});
});
