import { describe, expect } from "bun:test";

import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import { PluginId, TimeZone } from "@ryot-app/plugin-kit/schema";
import { bindRecipe } from "@ryot-app/ryotql-recipes/test-utils";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { bindWorkoutRecipe } from "../tests/workout-recipes.test-support";
import {
	workoutCardsRecipe,
	workoutCountRecipe,
	workoutIdsRecipe,
	workoutSummaryRecipe,
	workoutWeeksRecipe,
} from "./workout-list-recipes";

const aggregate = (items: readonly Record<string, unknown>[]) => ({
	items,
	type: "aggregate",
	pageInfo: { limit: 100, hasMore: false, nextCursor: null },
});
const range = { endAt: "2026-10-18T00:00:00.000Z", startAt: "2026-09-18T00:00:00.000Z" };
const workoutTotals = (workouts: number, activeDuration: null | number, timedWorkouts: number) => ({
	workouts,
	timedWorkouts,
	activeDuration,
});

describe("workoutWeeksRecipe", () => {
	it("merges set totals into workout weeks and zero-fills weeks without sets", () => {
		const recipe = bindRecipe(workoutWeeksRecipe({ reference: { kind: "self" } }), {
			search: "",
			endAt: { ...range, search: "", reference: { kind: "self" }, timeZone: TimeZone.make("UTC") }
				.endAt,
			startAt: { ...range, search: "", reference: { kind: "self" }, timeZone: TimeZone.make("UTC") }
				.startAt,
		});
		const decoded = Result.getOrThrow(
			recipe.decode({
				data: {
					sets: aggregate([{ volume: 9000, personalBests: 2, at: "2026-10-05T00:00:00.000Z" }]),
					workouts: aggregate([
						{ at: "2026-10-05T00:00:00.000Z", ...workoutTotals(2, 5400, 2) },
						{ at: "2026-10-12T00:00:00.000Z", ...workoutTotals(1, null, 0) },
					]),
				},
			}),
		);
		expect(decoded).toEqual([
			{
				workouts: 2,
				volume: 9000,
				personalBests: 2,
				timedWorkouts: 2,
				activeDuration: 5400,
				at: "2026-10-05T00:00:00.000Z",
			},
			{
				volume: 0,
				workouts: 1,
				personalBests: 0,
				timedWorkouts: 0,
				activeDuration: null,
				at: "2026-10-12T00:00:00.000Z",
			},
		]);
	});
});

describe("workoutSummaryRecipe", () => {
	const recipe = bindRecipe(workoutSummaryRecipe({ reference: { kind: "self" } }), {});
	it("stays within the document query limit", () => {
		expect(Object.keys(recipe.document.queries).length).toBeLessThanOrEqual(10);
	});

	it("bounds set totals by occurrence time instead of the workout start property", () => {
		const { queries } = recipe.document;
		for (const name of ["currentSets", "daySets", "latestRecord"]) {
			expect(JSON.stringify(queries[name])).toContain("occurredAt");
			expect(JSON.stringify(queries[name])).not.toContain("startedAt");
		}
	});

	it("treats a period without sets or records as zero volume and no latest record", () => {
		const decoded = Result.getOrThrow(
			recipe.decode({
				data: {
					daySets: aggregate([]),
					dayWorkouts: aggregate([]),
					currentWorkouts: aggregate([workoutTotals(3, 9000, 3)]),
					previousWorkouts: aggregate([workoutTotals(0, null, 0)]),
					currentSets: aggregate([{ volume: 12000, personalBests: 1 }]),
					previousSets: aggregate([{ volume: null, personalBests: null }]),
					latestRecord: {
						items: [],
						type: "rows",
						pageInfo: { limit: 1, hasMore: false, nextCursor: null },
					},
				},
			}),
		);
		expect(decoded).toEqual({
			days: [],
			latestRecord: null,
			previous: {
				volume: 0,
				workouts: 0,
				personalBests: 0,
				timedWorkouts: 0,
				activeDuration: null,
			},
			current: {
				workouts: 3,
				volume: 12000,
				personalBests: 1,
				timedWorkouts: 3,
				activeDuration: 9000,
			},
		});
	});
});

const serialize = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const documentText = (recipe: { readonly document: unknown }) => serialize(recipe.document);

describe("workout filter predicates", () => {
	const filter = { field: "template", operator: "anyOf", values: ["marker-workout"] } as const;
	const reference = { kind: "local", pluginId: PluginId.make("fitness-owner") } as const;
	it.effect(
		"reaches the ids query and decodes its page of workout ids",
		() =>
			Effect.gen(function* () {
				const recipe = bindWorkoutRecipe(
					workoutIdsRecipe({ reference: reference }),
					{ limit: 2, search: "legs" },
					filter,
				);
				const text = yield* documentText(recipe);
				expect(text).toContain("marker-workout");
				expect(text).toContain("legs");
				const pageInfo = { limit: 2, hasMore: true, nextCursor: "next" };
				expect(
					Result.getOrThrow(
						recipe.decode({
							data: {
								workoutIds: {
									pageInfo,
									type: "rows",
									items: [{ entityId: "w1" }, { entityId: "w2" }],
								},
							},
						}),
					),
				).toEqual({ pageInfo, items: ["w1", "w2"] });
			}),
		testTimeout,
	);

	it.effect(
		"reaches the cards and count queries",
		() =>
			Effect.gen(function* () {
				expect(
					yield* documentText(
						bindWorkoutRecipe(workoutCardsRecipe({ reference }), { search: "" }, filter),
					),
				).toContain("marker-workout");
				expect(
					yield* documentText(
						bindWorkoutRecipe(workoutCountRecipe({ reference }), { search: "" }, filter),
					),
				).toContain("marker-workout");
				expect(
					yield* documentText(
						bindRecipe(workoutCountRecipe({ reference: reference }), { search: "" }),
					),
				).not.toContain("marker-workout");
			}),
		testTimeout,
	);

	it.effect(
		"narrows both the workout and set queries of the week totals",
		() =>
			Effect.gen(function* () {
				const recipe = bindWorkoutRecipe(
					workoutWeeksRecipe({ reference }),
					{ ...range, search: "" },
					filter,
				);
				for (const name of ["workouts", "sets"]) {
					expect(yield* serialize(recipe.document.queries[name])).toContain("marker-workout");
				}
			}),
		testTimeout,
	);

	it.effect(
		"leaves the period summary unfiltered",
		() =>
			Effect.gen(function* () {
				const recipe = bindRecipe(workoutSummaryRecipe({ reference: reference }), {});
				expect(yield* documentText(recipe)).not.toContain("marker-workout");
			}),
		testTimeout,
	);

	it("scopes the filter source to the aliased workout table", () => {
		expect(workoutCardsRecipe({ reference }).document.controls?.filter).toMatchObject({
			alias: "workout",
		});
		expect(workoutWeeksRecipe({ reference }).document.controls?.filter).toMatchObject({
			alias: "weeksWorkout",
		});
	});
});
