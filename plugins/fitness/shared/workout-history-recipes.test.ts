import { expect, it } from "vitest";

import {
	workoutExercisePreviousValuesRecipe,
	workoutHistoryRecipe,
	workoutHistorySetsRecipe,
} from "./workout-history-recipes";

it("pages workouts containing the exercise before the anchor and excludes the current workout", () => {
	const recipe = workoutHistoryRecipe({
		after: "workout-cursor",
		exerciseId: "exercise-1",
		reference: { kind: "self" },
		excludeWorkoutId: "workout-current",
		beforeStartedAt: "2026-02-01T10:00:00.000Z",
	});
	const query = recipe.document.queries.workouts;
	if (query?.output.type !== "rows") {
		throw new Error("Expected history workout rows");
	}
	expect(query.output.pagination).toEqual({ limit: 100, after: "workout-cursor" });
	expect(query.output.orderBy).toMatchObject([
		{ direction: "desc", expr: expect.objectContaining({ type: "cast", target: "date" }) },
		{ direction: "asc", expr: { field: "id", type: "column", tableAlias: "historyWorkout" } },
	]);
	expect(query.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual(
		expect.arrayContaining(["id", "name", "startedAt", "comment"]),
	);
	expect(query.where).toMatchObject({
		type: "and",
		predicates: expect.arrayContaining([
			expect.objectContaining({
				operator: "lt",
				type: "comparison",
				right: {
					type: "cast",
					target: "date",
					expr: { type: "literal", value: "2026-02-01T10:00:00.000Z" },
				},
			}),
			expect.objectContaining({
				operator: "neq",
				type: "comparison",
				right: { type: "literal", value: "workout-current" },
			}),
			expect.objectContaining({
				type: "exists",
				query: expect.objectContaining({
					from: { table: "event", alias: "historyWorkoutSet" },
					where: expect.objectContaining({
						predicates: expect.arrayContaining([
							expect.objectContaining({
								right: { type: "literal", value: "exercise-1" },
								left: { type: "column", field: "entityId", tableAlias: "historyWorkoutSet" },
							}),
							expect.objectContaining({
								right: { field: "id", type: "column", tableAlias: "historyWorkout" },
								left: { type: "column", field: "sessionEntityId", tableAlias: "historyWorkoutSet" },
							}),
						]),
					}),
				}),
			}),
		]),
	});
	const where = JSON.stringify(query.where);
	expect(where).toContain('"field":"eventSchemaPluginId"');
	expect(where).toContain('"reference":{"kind":"self"}');
});

it("pages exercise set events in exercise and set order with the recorded kind and measurements", () => {
	const recipe = workoutHistorySetsRecipe({
		after: "set-cursor",
		workoutId: "workout-1",
		exerciseId: "exercise-1",
		reference: { kind: "self" },
	});
	const query = recipe.document.queries.sets;
	if (query?.output.type !== "rows") {
		throw new Error("Expected history set rows");
	}
	expect(query.output.pagination).toEqual({ limit: 100, after: "set-cursor" });
	expect(query.output.orderBy).toMatchObject([
		{ direction: "asc", expr: expect.objectContaining({ type: "cast", target: "number" }) },
		{ direction: "asc", expr: expect.objectContaining({ type: "cast", target: "number" }) },
		{ direction: "asc", expr: { field: "id", type: "column", tableAlias: "historySet" } },
	]);
	expect(query.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual(
		expect.arrayContaining([
			"id",
			"exerciseId",
			"occurredAt",
			"exerciseOrder",
			"setOrder",
			"recordedKind",
			"reps",
			"weight",
			"duration",
			"distance",
			"volume",
			"oneRm",
			"pace",
		]),
	);
	expect(query.where).toMatchObject({
		type: "and",
		predicates: expect.arrayContaining([
			expect.objectContaining({
				right: { type: "literal", value: "exercise-1" },
				left: { type: "column", field: "entityId", tableAlias: "historySet" },
			}),
			expect.objectContaining({
				right: { type: "literal", value: "workout-1" },
				left: { type: "column", field: "sessionEntityId", tableAlias: "historySet" },
			}),
		]),
	});
	const where = JSON.stringify(query.where);
	expect(where).toContain('"field":"eventSchemaPluginId"');
	expect(where).toContain('"field":"entitySchemaPluginId"');
});

it("pages all matching prior occurrences by descending session time and stable set order", () => {
	const recipe = workoutExercisePreviousValuesRecipe({
		exerciseId: "exercise-1",
		reference: { kind: "self" },
		after: "previous-set-cursor",
		recordedKind: "reps_and_weight",
		excludeWorkoutId: "workout-current",
		beforeStartedAt: "2026-02-01T10:00:00.000Z",
	});
	const query = recipe.document.queries.sets;
	if (query?.output.type !== "rows") {
		throw new Error("Expected prior set rows");
	}
	expect(query.output.pagination).toEqual({ limit: 100, after: "previous-set-cursor" });
	expect(query.output.orderBy).toMatchObject([
		{ direction: "desc", expr: expect.objectContaining({ type: "cast", target: "date" }) },
		{
			direction: "asc",
			expr: { type: "column", field: "sessionEntityId", tableAlias: "previousWorkoutSet" },
		},
		{ direction: "asc", expr: expect.objectContaining({ type: "cast", target: "number" }) },
		{ direction: "asc", expr: expect.objectContaining({ type: "cast", target: "number" }) },
		{ direction: "asc", expr: { field: "id", type: "column", tableAlias: "previousWorkoutSet" } },
	]);
	const where = JSON.stringify(query.where);
	expect(where).toContain('"path":["exerciseKind"]');
	expect(where).toContain('"value":"reps_and_weight"');
	expect(where).toContain('"operator":"lt"');
	expect(where).toContain('"value":"2026-02-01T10:00:00.000Z"');
	expect(where).toContain('"operator":"neq"');
	expect(where).toContain('"value":"workout-current"');
});
