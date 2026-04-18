import { describe, expect, it } from "bun:test";
import { createEntityFixture } from "#/features/test-fixtures";
import { getEntityDetailProperties } from "./detail";

describe("getEntityDetailProperties", () => {
	it("formats primitive schema properties in schema order", () => {
		const entity = createEntityFixture({
			properties: {
				completed: true,
				distanceKm: 5.25,
				notes: "Easy pace",
				startedOn: "2026-03-08",
				ignored: "not in schema",
				completedAt: "2026-03-08T10:15:00Z",
			},
		});

		const properties = getEntityDetailProperties(
			{
				fields: {
					notes: { label: "Notes", type: "string" },
					startedOn: { label: "Started On", type: "date" },
					distanceKm: { label: "Distance", type: "number" },
					completed: { label: "Completed", type: "boolean" },
					completedAt: { label: "Completed At", type: "datetime" },
				},
			},
			entity.properties,
		);

		expect(properties).toEqual([
			{
				key: "notes",
				type: "string",
				label: "Notes",
				value: "Easy pace",
				rawValue: "Easy pace",
			},
			{
				type: "date",
				key: "startedOn",
				label: "Started On",
				value: "March 8, 2026",
				rawValue: "2026-03-08",
			},
			{
				value: "5.25",
				rawValue: 5.25,
				type: "number",
				key: "distanceKm",
				label: "Distance",
			},
			{
				value: "Yes",
				rawValue: true,
				type: "boolean",
				key: "completed",
				label: "Completed",
			},
			{
				type: "datetime",
				key: "completedAt",
				label: "Completed At",
				rawValue: "2026-03-08T10:15:00Z",
				value: expect.any(String),
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
				fields: {
					mood: { label: "Mood", type: "string" },
					tags: {
						label: "Tags",
						type: "array",
						items: { label: "Item", type: "string" },
					},
					metadata: {
						type: "object",
						label: "Metadata",
						properties: { source: { label: "Source", type: "string" } },
					},
				},
			},
			entity.properties,
		);

		expect(properties.length).toBe(3);
		expect(properties[0]).toEqual({
			key: "mood",
			type: "string",
			label: "Mood",
			value: "strong",
			rawValue: "strong",
		});
		expect(properties[1]).toEqual({
			key: "tags",
			type: "array",
			label: "Tags",
			value: "tempo, morning",
			rawValue: ["tempo", "morning"],
		});
		expect(properties[2]).toEqual({
			key: "metadata",
			type: "object",
			label: "Metadata",
			value: "source: watch, version: 2.0",
			rawValue: { source: "watch", version: "2.0" },
		});
	});
});
