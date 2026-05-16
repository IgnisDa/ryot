import { describe, expect, it } from "bun:test";

import { dayjs } from "@ryot/ts-utils/dayjs";

import { createEntityFixture } from "~/features/test-fixtures";

import {
	getEntityListViewState,
	queryEngineEntityFieldKeys,
	sortEntities,
	toAppEntity,
} from "./model";

describe("sortEntities", () => {
	it("sorts entities by name first", () => {
		const entities = [
			createEntityFixture({
				id: "2",
				name: "Zebra",
				createdAt: dayjs("2024-01-01").toDate(),
			}),
			createEntityFixture({
				id: "1",
				name: "Apple",
				createdAt: dayjs("2024-01-02").toDate(),
			}),
		];

		const sorted = sortEntities(entities);

		expect(sorted[0]?.name).toBe("Apple");
		expect(sorted[1]?.name).toBe("Zebra");
	});

	it("sorts by createdAt when names are equal", () => {
		const entities = [
			createEntityFixture({
				id: "2",
				name: "Book",
				createdAt: dayjs("2024-01-02").toDate(),
			}),
			createEntityFixture({
				id: "1",
				name: "Book",
				createdAt: dayjs("2024-01-01").toDate(),
			}),
		];

		const sorted = sortEntities(entities);

		expect(sorted[0]?.id).toBe("1");
		expect(sorted[1]?.id).toBe("2");
	});

	it("returns empty array for empty input", () => {
		expect(sortEntities([])).toEqual([]);
	});
});

describe("getEntityListViewState", () => {
	it("returns empty state when there are no entities", () => {
		expect(getEntityListViewState([])).toEqual({ type: "empty" });
	});

	it("returns list state with sorted entities", () => {
		const entities = [
			createEntityFixture({
				id: "2",
				name: "Zebra",
				createdAt: dayjs("2024-01-01").toDate(),
			}),
			createEntityFixture({
				id: "1",
				name: "Apple",
				createdAt: dayjs("2024-01-02").toDate(),
			}),
		];

		const state = getEntityListViewState(entities);

		expect(state.type).toBe("list");

		if (state.type === "list") {
			expect(state.entities).toHaveLength(2);
			expect(state.entities[0]?.name).toBe("Apple");
			expect(state.entities[1]?.name).toBe("Zebra");
		}
	});
});

describe("toAppEntity", () => {
	it("converts serialized dates into Date instances", () => {
		const entity = toAppEntity({
			id: "entity-1",
			name: "Apple",
			properties: {},
			externalId: null,
			entitySchemaId: "schema-1",
			sandboxScriptId: null,
			createdAt: "2026-03-08T10:15:00.000Z",
			populatedAt: "2026-03-08T10:20:00.000Z",
			updatedAt: "2026-03-08T10:20:00.000Z",
			image: { type: "remote", url: "https://example.com/apple.jpg" },
		});

		expect(entity.createdAt).toBeInstanceOf(Date);
		expect(entity.updatedAt).toBeInstanceOf(Date);
		expect(entity.image).toEqual({
			type: "remote",
			url: "https://example.com/apple.jpg",
		});
		expect(dayjs(entity.createdAt).toISOString()).toBe("2026-03-08T10:15:00.000Z");
		expect(dayjs(entity.updatedAt).toISOString()).toBe("2026-03-08T10:20:00.000Z");
		expect(entity.sandboxScriptId).toBeNull();
		expect(entity.fields).toBeUndefined();
		expect(entity.entitySchemaId).toBe("schema-1");
	});

	it("preserves query-engine records as runtime fields", () => {
		const entity = toAppEntity({
			[queryEngineEntityFieldKeys.id]: { kind: "text", value: "entity-1" },
			[queryEngineEntityFieldKeys.name]: { kind: "text", value: "Apple" },
			[queryEngineEntityFieldKeys.image]: { kind: "null", value: null },
			[queryEngineEntityFieldKeys.createdAt]: {
				kind: "date",
				value: "2026-03-08T10:15:00.000Z",
			},
			[queryEngineEntityFieldKeys.updatedAt]: {
				kind: "date",
				value: "2026-03-08T10:20:00.000Z",
			},
			[queryEngineEntityFieldKeys.externalId]: { kind: "null", value: null },
			[queryEngineEntityFieldKeys.sandboxScriptId]: { kind: "null", value: null },
		});

		expect(entity.fields).toEqual({
			[queryEngineEntityFieldKeys.id]: { kind: "text", value: "entity-1" },
			[queryEngineEntityFieldKeys.name]: { kind: "text", value: "Apple" },
			[queryEngineEntityFieldKeys.image]: { kind: "null", value: null },
			[queryEngineEntityFieldKeys.createdAt]: {
				kind: "date",
				value: "2026-03-08T10:15:00.000Z",
			},
			[queryEngineEntityFieldKeys.updatedAt]: {
				kind: "date",
				value: "2026-03-08T10:20:00.000Z",
			},
			[queryEngineEntityFieldKeys.externalId]: { kind: "null", value: null },
			[queryEngineEntityFieldKeys.sandboxScriptId]: { kind: "null", value: null },
		});
		expect(entity.entitySchemaId).toBeUndefined();
		expect(entity.properties).toEqual({});
	});

	it("rejects partial query-engine records", () => {
		expect(() =>
			toAppEntity({
				[queryEngineEntityFieldKeys.id]: { kind: "text", value: "entity-1" },
			} as never),
		).toThrow("Query engine entity rows must include both entityId and entityName");
	});
});
