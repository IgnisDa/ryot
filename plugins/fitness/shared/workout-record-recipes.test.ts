import { describe, expect, it } from "bun:test";

import { workoutRecordPageRecipe } from "./workout-record-recipes";

const rows = (
	items: readonly Readonly<Record<string, unknown>>[],
	pageInfo: {
		readonly limit: number;
		readonly hasMore: boolean;
		readonly nextCursor: null | string;
	},
) => ({ items, pageInfo, type: "rows" });

const workoutRecord = (overrides: Readonly<Record<string, unknown>> = {}) => ({
	reps: 10,
	weight: 25,
	id: "set-1",
	distance: null,
	duration: null,
	exerciseKind: "reps_and_weight",
	...overrides,
});

const orderedLast = (path: string) => ({
	direction: "asc",
	expr: {
		type: "coalesce",
		values: [
			{
				type: "cast",
				target: "number",
				expr: {
					path: [path],
					type: "jsonPath",
					expr: { type: "column", field: "properties", tableAlias: "workoutRecord" },
				},
			},
			{ type: "literal", value: 2_147_483_647 },
		],
	},
});

const decodeRecord = (record: Readonly<Record<string, unknown>>) =>
	workoutRecordPageRecipe({ exerciseId: "exercise-1", reference: { kind: "self" } }).decode({
		data: { records: rows([record], { limit: 1, hasMore: false, nextCursor: null }) },
	});

describe("workout record recipes", () => {
	it("pages one exercise's sets in the stable null-last record order", () => {
		const records = workoutRecordPageRecipe({
			after: "cursor",
			exerciseId: "exercise-2",
			reference: { kind: "self" },
		});
		const recordsQuery = records.document.queries.records;
		if (recordsQuery?.output.type !== "rows") {
			throw new Error("Expected workout record rows query");
		}
		expect(recordsQuery.output.pagination).toEqual({ limit: 100, after: "cursor" });
		expect(recordsQuery.output.orderBy).toEqual<unknown>([
			{
				direction: "asc",
				expr: { type: "column", field: "occurredAt", tableAlias: "workoutRecord" },
			},
			{
				direction: "asc",
				expr: {
					type: "cast",
					target: "date",
					expr: {
						type: "jsonPath",
						path: ["startedAt"],
						expr: { type: "column", field: "properties", tableAlias: "workout" },
					},
				},
			},
			{
				direction: "asc",
				expr: { type: "column", field: "sessionEntityId", tableAlias: "workoutRecord" },
			},
			orderedLast("exerciseOrder"),
			orderedLast("setOrder"),
			{ direction: "asc", expr: { field: "id", type: "column", tableAlias: "workoutRecord" } },
		]);
		expect(recordsQuery.joins).toHaveLength(2);
		expect(JSON.stringify(recordsQuery.where)).toContain('"value":"exercise-2"');
	});

	it("decodes only nullable recorded measurements and supported kinds", () => {
		const decoded = decodeRecord(workoutRecord({ distance: 0 }));
		if (decoded._tag === "Failure") {
			throw decoded.failure;
		}
		expect(decoded.success.items).toEqual<unknown>([workoutRecord({ distance: 0 })]);
		expect(decodeRecord(workoutRecord({ exerciseKind: "unsupported" }))._tag).toBe("Failure");
	});
});
