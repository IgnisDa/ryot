import { describe, expect, it } from "bun:test";
import { getEntityListViewState, sortEntities } from "./model";

const createMockEntity = (overrides: {
	id: string;
	name: string;
	createdAt: Date;
}) => ({
	properties: {},
	externalId: null,
	id: overrides.id,
	name: overrides.name,
	updatedAt: new Date(),
	entitySchemaId: "schema-1",
	detailsSandboxScriptId: null,
	createdAt: overrides.createdAt,
});

describe("sortEntities", () => {
	it("sorts entities by name first", () => {
		const entities = [
			createMockEntity({
				id: "2",
				name: "Zebra",
				createdAt: new Date("2024-01-01"),
			}),
			createMockEntity({
				id: "1",
				name: "Apple",
				createdAt: new Date("2024-01-02"),
			}),
		];

		const sorted = sortEntities(entities);

		expect(sorted[0]?.name).toBe("Apple");
		expect(sorted[1]?.name).toBe("Zebra");
	});

	it("sorts by createdAt when names are equal", () => {
		const entities = [
			createMockEntity({
				id: "2",
				name: "Book",
				createdAt: new Date("2024-01-02"),
			}),
			createMockEntity({
				id: "1",
				name: "Book",
				createdAt: new Date("2024-01-01"),
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
			createMockEntity({
				id: "2",
				name: "Zebra",
				createdAt: new Date("2024-01-01"),
			}),
			createMockEntity({
				id: "1",
				name: "Apple",
				createdAt: new Date("2024-01-02"),
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
