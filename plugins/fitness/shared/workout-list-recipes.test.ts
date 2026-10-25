import { describe, expect, it } from "@effect/vitest";
import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import { column, eq, literal, table } from "@ryot-app/plugin-kit/ryotql";
import { TimeZone } from "@ryot-app/plugin-kit/schema";
import { Effect } from "effect";

import {
	workoutCardsRecipe,
	workoutCountRecipe,
	workoutFilterScope,
	workoutSummaryRecipe,
	workoutWeeksRecipe,
} from "./workout-list-recipes";

const aggregate = (items: readonly Record<string, unknown>[]) => ({
	type: "aggregate",
	pageInfo: { limit: 100, hasMore: false, nextCursor: null },
	items: items.map((item) => Object.assign({ failedSets: 0, pendingSets: 0 }, item)),
});
const range = { endAt: "2026-10-18T00:00:00.000Z", startAt: "2026-09-18T00:00:00.000Z" };
const workoutTotals = (workouts: number, activeDuration: null | number, timedWorkouts: number) => ({
	workouts,
	timedWorkouts,
	activeDuration,
});

describe("workoutWeeksRecipe", () => {
	it("keeps workout counts and entered duration while derived totals are pending or failed", () => {
		const recipe = workoutWeeksRecipe({
			...range,
			search: "",
			reference: { kind: "self" },
			timeZone: TimeZone.make("UTC"),
		});
		for (const coverage of [
			{ failedSets: 0, pendingSets: 1 },
			{ failedSets: 1, pendingSets: 0 },
		]) {
			const decoded = Result.getOrThrow(
				recipe.decode({
					data: {
						workouts: aggregate([{ ...workoutTotals(1, 600, 1), at: range.startAt }]),
						sets: aggregate([{ ...coverage, volume: 500, personalBests: 1, at: range.startAt }]),
					},
				}),
			);
			expect(decoded[0]).toMatchObject({
				workouts: 1,
				volume: null,
				activeDuration: 600,
				personalBests: null,
			});
		}
	});
	it("merges set totals into workout weeks and zero-fills weeks without sets", () => {
		const recipe = workoutWeeksRecipe({
			...range,
			search: "",
			reference: { kind: "self" },
			timeZone: TimeZone.make("UTC"),
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
	const recipe = workoutSummaryRecipe({
		days: range,
		current: range,
		previous: range,
		reference: { kind: "self" },
		timeZone: TimeZone.make("UTC"),
	});

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
	const filter = eq(column(table("entity", "workout"), "id"), literal("marker-workout"));
	const reference = { kind: "self" } as const;

	it.effect("reaches the cards and count queries", () =>
		Effect.gen(function* () {
			expect(yield* documentText(workoutCardsRecipe({ filter, reference, search: "" }))).toContain(
				"marker-workout",
			);
			expect(yield* documentText(workoutCountRecipe({ filter, reference, search: "" }))).toContain(
				"marker-workout",
			);
			expect(yield* documentText(workoutCountRecipe({ reference, search: "" }))).not.toContain(
				"marker-workout",
			);
		}),
	);

	it.effect("narrows both the workout and set queries of the week totals", () =>
		Effect.gen(function* () {
			const recipe = workoutWeeksRecipe({
				...range,
				filter,
				reference,
				search: "",
				timeZone: TimeZone.make("UTC"),
			});
			for (const query of Object.values(recipe.document.queries)) {
				expect(yield* serialize(query)).toContain("marker-workout");
			}
		}),
	);

	it.effect("leaves the period summary unfiltered", () =>
		Effect.gen(function* () {
			const recipe = workoutSummaryRecipe({
				reference,
				days: range,
				current: range,
				previous: range,
				timeZone: TimeZone.make("UTC"),
			});
			expect(yield* documentText(recipe)).not.toContain("marker-workout");
		}),
	);

	it("scopes the filter source to the aliased workout table", () => {
		expect(workoutFilterScope("list").subject).toEqual({ entityAlias: "workout" });
		expect(workoutFilterScope("weeks").subject).toEqual({ entityAlias: "weeksWorkout" });
	});
});
