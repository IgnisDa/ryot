import { describe, expect, it } from "bun:test";

import { bindRecipe } from "@ryot-app/ryotql-recipes/test-utils";

import {
	workoutRecordRangeArguments,
	workoutRecordRangeRecipe,
	workoutRecordsRecipe,
} from "./workout-record-recipes";

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
	setOrder: 1,
	distance: null,
	duration: null,
	exerciseOrder: null,
	sessionEntityId: "workout-1",
	exerciseKind: "reps_and_weight",
	startedAt: "2026-01-01T00:00:00.000Z",
	occurredAt: "2026-01-01T00:00:00.000Z",
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
			{ type: "literal", value: 2147483647 },
		],
	},
});

const decodeRecord = (record: Readonly<Record<string, unknown>>) =>
	bindRecipe(workoutRecordsRecipe, { exerciseId: "exercise-1" }).decode({
		data: { records: rows([record], { limit: 1, hasMore: false, nextCursor: null }) },
	});
describe("workout record recipes", () => {
	it("pages one exercise's sets in the stable null-last record order", () => {
		const records = bindRecipe(workoutRecordsRecipe, { after: "cursor", exerciseId: "exercise-2" });
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

	it("narrows a range read to later sets whose candidate may lie in a changed bound", () => {
		const records = bindRecipe(workoutRecordRangeRecipe, {
			exerciseId: "exercise-1",
			...workoutRecordRangeArguments({
				excluded: ["set-9"],
				from: "2026-01-02T00:00:00.000Z",
				bounds: [{ above: 50, atMost: 80, type: "one_rm", kind: "reps_and_weight" }],
			}),
		});
		const where = JSON.stringify(records.document.queries.records?.where);
		expect(where).toContain('"value":"2026-01-02T00:00:00.000Z"');
		expect(where).toContain('"value":"set-9"');
		expect(where).toContain('"path":["oneRm"]');
		expect(where).toContain('"value":49.999');
		expect(where).toContain('"value":80.001');
	});

	it("reads each record type over its widest changed bound across exercise kinds", () => {
		expect(
			workoutRecordRangeArguments({
				excluded: [],
				from: "2026-01-02T00:00:00.000Z",
				bounds: [
					{ above: 50, atMost: 80, type: "weight", kind: "reps_and_weight" },
					{ above: 20, atMost: 60, kind: "reps", type: "weight" },
				],
			}),
		).toEqual<unknown>({
			weightAbove: 19.999,
			weightAtMost: 80.001,
			from: "2026-01-02T00:00:00.000Z",
		});
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
