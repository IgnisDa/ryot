import { describe, expect, it } from "vitest";

import { workoutSetsRecipe } from "./workout-details-recipes";

const rows = (
	items: readonly Readonly<Record<string, unknown>>[],
	pageInfo: {
		readonly limit: number;
		readonly hasMore: boolean;
		readonly nextCursor: string | null;
	},
) => ({ items, pageInfo, type: "rows" });

const columnExpression = (tableAlias: string, field: string) => ({
	field,
	tableAlias,
	type: "column",
});

const equality = (left: unknown, right: unknown) =>
	expect.objectContaining({ left, right, operator: "eq", type: "comparison" });

const nullableEquality = (left: unknown, right: unknown) =>
	expect.objectContaining({
		type: "or",
		predicates: expect.arrayContaining([
			expect.objectContaining({
				type: "and",
				predicates: expect.arrayContaining([
					expect.objectContaining({ expr: left, type: "isNull" }),
					expect.objectContaining({ expr: right, type: "isNull" }),
				]),
			}),
			equality(left, right),
		]),
	});

describe("workout set recipe", () => {
	it("builds a paged event query with workout and exercise provenance", () => {
		const recipe = workoutSetsRecipe({ limit: 25, after: "set-cursor", workoutId: "workout-1" });
		const workoutSets = recipe.document.queries["workoutSets"];
		if (workoutSets?.output.type !== "rows") {
			throw new Error("Expected workout set rows query");
		}

		expect(workoutSets.from).toEqual({ table: "event", alias: "workoutSet" });
		expect(workoutSets.output.pagination).toEqual({ limit: 25, after: "set-cursor" });
		expect(
			workoutSetsRecipe({ limit: 200, workoutId: "workout-1" }).document.queries.workoutSets
				?.output,
		).toMatchObject({ pagination: { limit: 100 } });
		expect(workoutSets.joins).toEqual([
			expect.objectContaining({ table: { table: "entity", alias: "workout" } }),
			expect.objectContaining({ table: { table: "entity", alias: "exercise" } }),
		]);
		expect(workoutSets.where).toEqual(
			expect.objectContaining({
				predicates: expect.arrayContaining([
					expect.objectContaining({
						right: { type: "literal", value: "workout-1" },
						left: { type: "column", field: "sessionEntityId", tableAlias: "workoutSet" },
					}),
					expect.objectContaining({ right: { type: "literal", value: "workout-set" } }),
					expect.objectContaining({ right: { type: "literal", value: "workout" } }),
					expect.objectContaining({ right: { type: "literal", value: "exercise" } }),
				]),
			}),
		);
		expect(
			workoutSets.output.fields.flatMap((field) => ("key" in field ? [field.key] : [])),
		).toEqual(
			expect.arrayContaining([
				"id",
				"occurredAt",
				"confirmedAt",
				"restTime",
				"personalBests",
				"recordStatus",
				"reps",
				"weight",
				"duration",
				"distance",
				"pace",
				"oneRm",
				"volume",
				"setOrder",
				"exerciseOrder",
				"kind",
				"previousSessionId",
			]),
		);

		const previousSessionField = workoutSets.output.fields.find(
			(field) => "key" in field && field.key === "previousSessionId",
		);
		if (previousSessionField === undefined || !("expr" in previousSessionField)) {
			throw new Error("Expected previous session selection");
		}
		const previousSession = previousSessionField.expr;
		expect(previousSession).toMatchObject({
			type: "first",
			select: { type: "column", field: "sessionEntityId", tableAlias: "previousWorkoutSet" },
			orderBy: [
				expect.objectContaining({
					direction: "desc",
					expr: expect.objectContaining({
						type: "cast",
						expr: expect.objectContaining({
							path: ["startedAt"],
							expr: expect.objectContaining({ tableAlias: "previousWorkout" }),
						}),
					}),
				}),
				expect.objectContaining({
					direction: "asc",
					expr: { type: "column", field: "sessionEntityId", tableAlias: "previousWorkoutSet" },
				}),
			],
			query: {
				from: { table: "event", alias: "previousWorkoutSet" },
				joins: [expect.objectContaining({ table: { table: "entity", alias: "previousWorkout" } })],
				where: {
					type: "and",
					predicates: expect.arrayContaining([
						expect.objectContaining({
							right: expect.objectContaining({ field: "id", tableAlias: "exercise" }),
							left: expect.objectContaining({
								field: "entityId",
								tableAlias: "previousWorkoutSet",
							}),
						}),
						expect.objectContaining({ right: { type: "literal", value: "workout-set" } }),
						expect.objectContaining({ right: { type: "literal", value: "workout" } }),
						expect.objectContaining({ type: "or" }),
						expect.objectContaining({
							operator: "lt",
							right: expect.objectContaining({
								type: "cast",
								expr: expect.objectContaining({
									path: ["startedAt"],
									expr: expect.objectContaining({ tableAlias: "workout" }),
								}),
							}),
							left: expect.objectContaining({
								type: "cast",
								expr: expect.objectContaining({
									path: ["startedAt"],
									expr: expect.objectContaining({ tableAlias: "previousWorkout" }),
								}),
							}),
						}),
					]),
				},
			},
		});

		const recordStatusField = workoutSets.output.fields.find(
			(field) => "key" in field && field.key === "recordStatus",
		);
		if (recordStatusField === undefined || !("expr" in recordStatusField)) {
			throw new Error("Expected record status selection");
		}
		expect(recordStatusField.expr).toMatchObject({
			type: "coalesce",
			values: [
				{
					type: "first",
					select: {
						type: "conditional",
						whenTrue: { type: "literal", value: "failed" },
						condition: equality(columnExpression("workoutSetWork", "status"), {
							type: "literal",
							value: "failed",
						}),
						whenFalse: {
							type: "conditional",
							whenTrue: { value: "ready", type: "literal" },
							whenFalse: { type: "literal", value: "pending" },
							condition: expect.objectContaining({
								type: "and",
								predicates: expect.arrayContaining([
									equality(columnExpression("workoutSetWork", "status"), {
										type: "literal",
										value: "completed",
									}),
									equality(
										columnExpression("workoutSetWork", "claimedRevision"),
										columnExpression("workoutSetStream", "revision"),
									),
								]),
							}),
						},
					},
					query: {
						from: { alias: "workoutSetWork", table: "eventStreamWork" },
						joins: [
							expect.objectContaining({
								type: "inner",
								table: { table: "eventStream", alias: "workoutSetStream" },
								on: equality(
									columnExpression("workoutSetWork", "id"),
									columnExpression("workoutSetStream", "id"),
								),
							}),
						],
						where: expect.objectContaining({
							predicates: expect.arrayContaining([
								equality(
									columnExpression("workoutSetStream", "entityId"),
									columnExpression("exercise", "id"),
								),
								nullableEquality(
									columnExpression("workoutSetStream", "eventSchemaPluginId"),
									columnExpression("exercise", "entitySchemaPluginId"),
								),
								nullableEquality(
									columnExpression("workoutSetStream", "eventSchemaPluginId"),
									columnExpression("workoutSet", "eventSchemaPluginId"),
								),
								equality(
									columnExpression("workoutSetStream", "eventSchemaSlug"),
									columnExpression("workoutSet", "eventSchemaSlug"),
								),
							]),
						}),
					},
				},
				{
					type: "conditional",
					whenFalse: { value: "ready", type: "literal" },
					whenTrue: { type: "literal", value: "pending" },
					condition: {
						type: "isNull",
						expr: {
							type: "jsonPath",
							path: ["personalBests"],
							expr: columnExpression("workoutSet", "properties"),
						},
					},
				},
			],
		});
	});

	it("keeps nullable set data and root page information in the mapped result", () => {
		const decoded = workoutSetsRecipe({ limit: 2, workoutId: "workout-1" }).decode({
			data: {
				workoutSets: rows(
					[
						{
							reps: 8,
							weight: 60,
							pace: null,
							id: "set-1",
							volume: 480,
							setOrder: 0,
							restTime: null,
							duration: null,
							distance: null,
							oneRm: 24.827586,
							exerciseOrder: 1,
							unitSystem: null,
							confirmedAt: null,
							recordStatus: "ready",
							workoutId: "workout-1",
							kind: "reps_and_weight",
							workoutName: "Push day",
							previousSessionId: null,
							exerciseId: "exercise-1",
							exerciseName: "Bench Press",
							personalBests: ["reps", "one_rm"],
							occurredAt: "2026-09-07T08:10:00.000Z",
							workoutStartedAt: "2026-09-07T08:00:00.000Z",
						},
					],
					{ limit: 2, hasMore: true, nextCursor: "next-set-page" },
				),
			},
		});

		expect(decoded).toEqual({
			success: {
				pageInfo: { limit: 2, hasMore: true, nextCursor: "next-set-page" },
				items: [
					{
						reps: 8,
						weight: 60,
						pace: null,
						volume: 480,
						id: "set-1",
						setOrder: 0,
						duration: null,
						restTime: null,
						distance: null,
						unitSystem: null,
						exerciseOrder: 1,
						oneRm: 24.827586,
						confirmedAt: null,
						recordStatus: "ready",
						workoutId: "workout-1",
						workoutName: "Push day",
						kind: "reps_and_weight",
						previousSessionId: null,
						exerciseId: "exercise-1",
						exerciseName: "Bench Press",
						personalBests: ["reps", "one_rm"],
						occurredAt: "2026-09-07T08:10:00.000Z",
						workoutStartedAt: "2026-09-07T08:00:00.000Z",
					},
				],
			},
		});
	});
});
