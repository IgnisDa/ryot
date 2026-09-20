import { describe, expect, it } from "vitest";

import { workoutPresentationRecipe } from "./workout-presentation-query";

const rows = (items: readonly Record<string, unknown>[], limit: number) => ({
	items,
	type: "rows",
	pageInfo: { limit, hasMore: false, nextCursor: null },
});

describe("workout presentation recipe", () => {
	it("batches requested workouts and their session set events", () => {
		const recipe = workoutPresentationRecipe(["workout-2", "workout-1"]);
		const workouts = recipe.document.queries["workouts"];
		if (workouts?.output.type !== "rows") {
			throw new Error("Expected workout presentation rows query");
		}

		expect(workouts.where).toEqual(
			expect.objectContaining({
				predicates: expect.arrayContaining([
					expect.objectContaining({
						values: [
							{ type: "literal", value: "workout-2" },
							{ type: "literal", value: "workout-1" },
						],
					}),
				]),
			}),
		);
		expect(workouts.output.pagination).toEqual({ limit: 100 });
		expect(workouts.output.fields).toEqual(
			expect.arrayContaining([
				{ key: "name", expr: { field: "name", type: "column", tableAlias: "presentationWorkout" } },
				{
					key: "startedAt",
					expr: {
						type: "cast",
						target: "date",
						expr: {
							type: "jsonPath",
							path: ["startedAt"],
							expr: { type: "column", field: "properties", tableAlias: "presentationWorkout" },
						},
					},
				},
			]),
		);
		expect(workouts.output.include).toEqual([
			expect.objectContaining({
				limit: 100,
				key: "sets",
				from: { table: "event", alias: "presentationSet" },
				joins: [
					expect.objectContaining({ table: { table: "entity", alias: "presentationExercise" } }),
				],
				where: expect.objectContaining({
					predicates: expect.arrayContaining([
						expect.objectContaining({
							right: expect.objectContaining({ field: "id", tableAlias: "presentationWorkout" }),
							left: expect.objectContaining({
								field: "sessionEntityId",
								tableAlias: "presentationSet",
							}),
						}),
						expect.objectContaining({ right: { type: "literal", value: "workout-set" } }),
						expect.objectContaining({ right: { type: "literal", value: "exercise" } }),
					]),
				}),
			}),
		]);
		expect(recipe.document.queries).not.toHaveProperty("sets");
	});

	it("decodes and groups real set values by workout and exercise", () => {
		const decoded = workoutPresentationRecipe(["workout-1"]).decode({
			data: {
				workouts: rows(
					[
						{
							id: "workout-1",
							name: "Push day",
							exerciseNotes: null,
							endedAt: "2026-09-07T09:30:00.000Z",
							startedAt: "2026-09-07T08:00:00.000Z",
							sets: rows(
								[
									{
										reps: 8,
										weight: 60,
										setOrder: 0,
										duration: null,
										distance: null,
										exerciseOrder: 0,
										unitSystem: "metric",
										exerciseId: "exercise-1",
										exerciseName: "Bench Press",
									},
								],
								100,
							),
						},
					],
					100,
				),
			},
		});

		expect(decoded).toEqual({
			success: [
				{
					id: "workout-1",
					name: "Push day",
					endedAt: "2026-09-07T09:30:00.000Z",
					startedAt: "2026-09-07T08:00:00.000Z",
					exercises: [
						{
							order: 0,
							notes: [],
							id: "exercise-1",
							name: "Bench Press",
							sets: [
								{
									reps: 8,
									weight: 60,
									setOrder: 0,
									duration: null,
									distance: null,
									exerciseOrder: 0,
									unitSystem: "metric",
									exerciseId: "exercise-1",
									exerciseName: "Bench Press",
								},
							],
						},
					],
				},
			],
		});
	});

	it("keeps repeated exercise occurrences separate and attaches notes by order", () => {
		const decoded = workoutPresentationRecipe(["workout-1"]).decode({
			data: {
				workouts: rows(
					[
						{
							id: "workout-1",
							name: "Push day",
							endedAt: "2026-09-07T09:30:00.000Z",
							startedAt: "2026-09-07T08:00:00.000Z",
							exerciseNotes: [
								{ exerciseOrder: 0, notes: ["Brace before each rep."] },
								{ exerciseOrder: 2, notes: ["Pause at the top."] },
								{ exerciseOrder: 3, notes: ["No sets for this note."] },
							],
							sets: rows(
								[
									{
										reps: 6,
										weight: 60,
										setOrder: 1,
										duration: null,
										distance: null,
										exerciseOrder: 0,
										unitSystem: "metric",
										exerciseId: "exercise-1",
										exerciseName: "Bench Press",
									},
									{
										reps: 10,
										weight: 20,
										setOrder: 0,
										duration: null,
										distance: null,
										exerciseOrder: 1,
										unitSystem: "metric",
										exerciseId: "exercise-2",
										exerciseName: "Incline Press",
									},
									{
										reps: 8,
										weight: 60,
										setOrder: 0,
										duration: null,
										distance: null,
										exerciseOrder: 0,
										unitSystem: "metric",
										exerciseId: "exercise-1",
										exerciseName: "Bench Press",
									},
									{
										reps: 5,
										weight: 60,
										setOrder: 0,
										duration: null,
										distance: null,
										exerciseOrder: 2,
										unitSystem: "metric",
										exerciseId: "exercise-1",
										exerciseName: "Bench Press",
									},
								],
								100,
							),
						},
					],
					100,
				),
			},
		});

		expect(decoded).toEqual({
			success: [
				expect.objectContaining({
					exercises: [
						expect.objectContaining({
							order: 0,
							id: "exercise-1",
							name: "Bench Press",
							notes: ["Brace before each rep."],
							sets: [
								expect.objectContaining({ reps: 6, setOrder: 1 }),
								expect.objectContaining({ reps: 8, setOrder: 0 }),
							],
						}),
						expect.objectContaining({
							order: 1,
							notes: [],
							id: "exercise-2",
							name: "Incline Press",
							sets: [expect.objectContaining({ reps: 10, setOrder: 0 })],
						}),
						expect.objectContaining({
							order: 2,
							id: "exercise-1",
							name: "Bench Press",
							notes: ["Pause at the top."],
							sets: [expect.objectContaining({ reps: 5, setOrder: 0 })],
						}),
					],
				}),
			],
		});
	});
});
