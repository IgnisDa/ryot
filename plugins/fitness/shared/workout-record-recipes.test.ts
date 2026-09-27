import { describe, expect, it } from "vitest";

import {
	existingExerciseIdsRecipe,
	workoutRecordRowsRecipe,
	workoutSetContextRecipe,
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
	pace: null,
	weight: 25,
	id: "set-1",
	setOrder: 0,
	volume: 250,
	distance: null,
	duration: null,
	oneRm: 33.333333,
	confirmedAt: null,
	exerciseOrder: null,
	personalBests: null,
	sessionId: "workout-1",
	exerciseId: "exercise-1",
	exerciseKind: "reps_and_weight",
	occurredAt: "2026-01-01T08:10:00.000Z",
	workoutStartedAt: "2026-01-01T08:00:00.000Z",
	...overrides,
});

describe("workout record recipes", () => {
	it("reads the current exercise and workout context", () => {
		const context = workoutSetContextRecipe({ workoutId: "workout-1", exerciseId: "exercise-1" });
		expect(Object.keys(context.document.queries)).toEqual(["exercise", "workout"]);
		expect(context.document.queries.exercise?.where).toMatchObject({
			type: "and",
			predicates: expect.arrayContaining([
				expect.objectContaining({ left: { field: "id", type: "column", tableAlias: "exercise" } }),
				expect.objectContaining({ right: { type: "literal", value: "exercise" } }),
			]),
		});
		expect(context.document.queries.workout?.output).toMatchObject({
			type: "rows",
			fields: expect.arrayContaining([expect.objectContaining({ key: "startedAt" })]),
		});
	});

	it("reads only existing exercise identities for a bounded stream request", () => {
		const recipe = existingExerciseIdsRecipe({ exerciseIds: ["exercise-1", "deleted-exercise"] });
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

	it.each([
		["entity", "entityId", "exercise-1"],
		["session", "sessionEntityId", "workout-1"],
	] as const)(
		"pages workout-set exercises by %s subject",
		(role, subjectField, subjectEntityId) => {
			const recipe = workoutSetExerciseIdsRecipe({ role, subjectEntityId, after: "event-cursor" });
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
						right: { type: "literal", value: subjectEntityId },
						left: { type: "column", field: subjectField, tableAlias: "workoutSetContextEvent" },
					}),
					expect.objectContaining({
						right: { type: "literal", value: "workout-set" },
						left: {
							type: "column",
							field: "eventSchemaSlug",
							tableAlias: "workoutSetContextEvent",
						},
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
		},
	);

	it("pages normalized anchors by event id and record rows by the stable null-last record order", () => {
		const normalization = workoutRecordRowsRecipe({
			limit: 200,
			order: "id",
			after: "id-cursor",
			exerciseId: "exercise-1",
		});
		const idQuery = normalization.document.queries.records;
		if (idQuery?.output.type !== "rows") {
			throw new Error("Expected workout record rows query");
		}
		expect(idQuery.output.pagination).toEqual({ limit: 100, after: "id-cursor" });
		expect(idQuery.output.orderBy).toEqual([
			{ direction: "asc", expr: { field: "id", type: "column", tableAlias: "workoutRecord" } },
		]);

		const records = workoutRecordRowsRecipe({
			limit: 100,
			order: "records",
			after: "record-cursor",
			exerciseId: "exercise-1",
		});
		const recordsQuery = records.document.queries.records;
		if (recordsQuery?.output.type !== "rows") {
			throw new Error("Expected workout record rows query");
		}
		expect(recordsQuery.output.orderBy).toMatchObject([
			{
				direction: "asc",
				expr: { type: "column", field: "occurredAt", tableAlias: "workoutRecord" },
			},
			{ direction: "asc", expr: { type: "cast" } },
			{
				direction: "asc",
				expr: { type: "column", field: "sessionEntityId", tableAlias: "workoutRecord" },
			},
			{ direction: "asc", expr: { type: "cast", expr: { path: ["exerciseOrder"] } } },
			{ direction: "asc", expr: { type: "cast", expr: { path: ["setOrder"] } } },
			{ direction: "asc", expr: { field: "id", type: "column", tableAlias: "workoutRecord" } },
		]);
		expect(recordsQuery.joins).toHaveLength(2);
		expect(
			recordsQuery.output.fields.flatMap((field) => ("key" in field ? [field.key] : [])),
		).toEqual(
			expect.arrayContaining([
				"id",
				"exerciseKind",
				"workoutStartedAt",
				"occurredAt",
				"confirmedAt",
				"reps",
				"weight",
				"duration",
				"distance",
				"oneRm",
				"volume",
				"pace",
				"personalBests",
			]),
		);
	});

	it("decodes required context, nullable measurements, and stored outputs", () => {
		const decoded = workoutRecordRowsRecipe({
			limit: 1,
			order: "records",
			exerciseId: "exercise-1",
		}).decode({
			data: {
				records: rows([workoutRecord({ distance: 0, exerciseOrder: 2 })], {
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
			expect.objectContaining({
				id: "set-1",
				distance: 0,
				confirmedAt: null,
				personalBests: null,
				exerciseKind: "reps_and_weight",
			}),
		]);

		const invalidKind = workoutRecordRowsRecipe({
			limit: 1,
			order: "records",
			exerciseId: "exercise-1",
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
