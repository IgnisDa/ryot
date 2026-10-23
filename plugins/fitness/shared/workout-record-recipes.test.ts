import { describe, expect, it } from "vitest";

import {
	existingExerciseIdsRecipe,
	workoutRecordRowsRecipe,
	workoutSetExerciseIdsRecipe,
} from "./workout-record-recipes";

const rows = (
	items: readonly Readonly<Record<string, unknown>>[],
	pageInfo: {
		readonly limit: number;
		readonly hasMore: boolean;
		readonly nextCursor: string | null;
	},
) => ({ items, pageInfo, type: "rows" });

const workoutRecord = (overrides: Readonly<Record<string, unknown>> = {}) => ({
	reps: 10,
	weight: 25,
	id: "set-1",
	distance: null,
	duration: null,
	exerciseKind: "reps_and_weight",
	occurredAt: "2026-01-01T08:10:00.000Z",
	workoutStartedAt: "2026-01-01T08:00:00.000Z",
	...overrides,
});

describe("workout record recipes", () => {
	it("reads only existing exercise identities for a bounded stream request", () => {
		const recipe = existingExerciseIdsRecipe({
			reference: { kind: "self" },
			exerciseIds: ["exercise-1", "deleted-exercise"],
		});
		const query = recipe.document.queries.exercises;
		if (query?.output.type !== "rows") {
			throw new Error("Expected exercise rows query");
		}
		expect(query.output.pagination).toEqual({ limit: 2 });
		expect(query.output.fields).toEqual([
			{ key: "id", expr: { field: "id", type: "column", tableAlias: "exercise" } },
		]);
		const decoded = recipe.decode({
			data: {
				exercises: rows([{ id: "exercise-1" }], { limit: 2, hasMore: false, nextCursor: null }),
			},
		});
		if (decoded._tag === "Failure") {
			throw decoded.failure;
		}
		expect(decoded.success).toEqual(["exercise-1"]);
	});

	it("pages the exercises of a workout's sets", () => {
		const recipe = workoutSetExerciseIdsRecipe({
			after: "event-cursor",
			workoutId: "workout-1",
			reference: { kind: "self" },
		});
		const query = recipe.document.queries.workoutSetExerciseIds;
		if (query?.output.type !== "rows") {
			throw new Error("Expected workout-set exercise rows query");
		}
		expect(query.output.pagination).toEqual({ limit: 50, after: "event-cursor" });
		expect(query.output.orderBy).toEqual([
			{
				direction: "asc",
				expr: { field: "id", type: "column", tableAlias: "workoutSetContextEvent" },
			},
		]);
		expect(query.output.fields).toEqual([
			{
				key: "entityId",
				expr: { type: "column", field: "entityId", tableAlias: "workoutSetContextEvent" },
			},
		]);
		expect(query.joins).toHaveLength(2);
		expect(query.where).toMatchObject({
			type: "and",
			predicates: expect.arrayContaining([
				expect.objectContaining({
					right: { type: "literal", value: "workout-1" },
					left: { type: "column", field: "sessionEntityId", tableAlias: "workoutSetContextEvent" },
				}),
				expect.objectContaining({
					right: { type: "literal", value: "workout-set" },
					left: { type: "column", field: "eventSchemaSlug", tableAlias: "workoutSetContextEvent" },
				}),
			]),
		});
		const decoded = recipe.decode({
			data: {
				workoutSetExerciseIds: rows([{ entityId: "exercise-1" }, { entityId: "exercise-2" }], {
					limit: 50,
					hasMore: true,
					nextCursor: "next-event",
				}),
			},
		});
		if (decoded._tag === "Failure") {
			throw decoded.failure;
		}
		expect(decoded.success).toEqual({
			items: [{ entityId: "exercise-1" }, { entityId: "exercise-2" }],
			pageInfo: { limit: 50, hasMore: true, nextCursor: "next-event" },
		});
	});

	it("pages records by the stable null-last record order", () => {
		const records = workoutRecordRowsRecipe({
			limit: 200,
			after: "record-cursor",
			exerciseId: "exercise-1",
			reference: { kind: "self" },
		});
		const recordsQuery = records.document.queries.records;
		if (recordsQuery?.output.type !== "rows") {
			throw new Error("Expected workout record rows query");
		}
		expect(recordsQuery.output.pagination).toEqual({ limit: 100, after: "record-cursor" });
		expect(recordsQuery.output.orderBy).toEqual([
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
			{
				direction: "asc",
				expr: {
					type: "cast",
					target: "number",
					expr: {
						type: "jsonPath",
						path: ["exerciseOrder"],
						expr: { type: "column", field: "properties", tableAlias: "workoutRecord" },
					},
				},
			},
			{
				direction: "asc",
				expr: {
					type: "cast",
					target: "number",
					expr: {
						type: "jsonPath",
						path: ["setOrder"],
						expr: { type: "column", field: "properties", tableAlias: "workoutRecord" },
					},
				},
			},
			{ direction: "asc", expr: { field: "id", type: "column", tableAlias: "workoutRecord" } },
		]);
		expect(recordsQuery.joins).toHaveLength(2);
		expect(
			recordsQuery.output.fields.flatMap((field) => ("key" in field ? [field.key] : [])),
		).toEqual([
			"id",
			"workoutStartedAt",
			"occurredAt",
			"exerciseKind",
			"reps",
			"weight",
			"duration",
			"distance",
		]);
	});

	it("decodes only source context and nullable recorded measurements", () => {
		const decoded = workoutRecordRowsRecipe({
			limit: 1,
			exerciseId: "exercise-1",
			reference: { kind: "self" },
		}).decode({
			data: {
				records: rows([workoutRecord({ distance: 0 })], {
					limit: 1,
					hasMore: false,
					nextCursor: null,
				}),
			},
		});
		if (decoded._tag === "Failure") {
			throw decoded.failure;
		}
		expect(decoded.success.items).toEqual([
			{
				reps: 10,
				weight: 25,
				id: "set-1",
				distance: 0,
				duration: null,
				exerciseKind: "reps_and_weight",
				occurredAt: "2026-01-01T08:10:00.000Z",
				workoutStartedAt: "2026-01-01T08:00:00.000Z",
			},
		]);

		const invalidKind = workoutRecordRowsRecipe({
			limit: 1,
			exerciseId: "exercise-1",
			reference: { kind: "self" },
		}).decode({
			data: {
				records: rows([workoutRecord({ exerciseKind: "unsupported" })], {
					limit: 1,
					hasMore: false,
					nextCursor: null,
				}),
			},
		});
		expect(invalidKind._tag).toBe("Failure");
	});
});
