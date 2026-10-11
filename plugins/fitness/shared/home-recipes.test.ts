import { Result } from "@ryot-app/plugin-kit/effect";
import { describe, expect, it } from "vitest";

import {
	homeTemplatesRecipe,
	muscleActivityRecipe,
	recentPersonalBestsRecipe,
} from "./home-recipes";

const reference = { kind: "self" } as const;
const rows = (items: readonly Record<string, unknown>[]) => ({
	items,
	type: "rows",
	pageInfo: { limit: 100, hasMore: false, nextCursor: null },
});
const aggregate = (items: readonly Record<string, unknown>[]) => ({ items, type: "aggregate" });

describe("muscleActivityRecipe", () => {
	const recipe = muscleActivityRecipe({ reference, weekStartAt: "2026-10-14T00:00:00.000Z" });

	it("uses one target aggregate", () => {
		expect(Object.keys(recipe.document.queries)).toEqual(["activity"]);
	});

	it("normalizes null totals and orders never-trained then longest since first", () => {
		const decoded = Result.getOrThrow(
			recipe.decode({
				data: {
					activity: aggregate([
						{
							id: "chest",
							name: "Chest",
							weeklySets: 5,
							lastTrainedAt: "2026-10-15T09:00:00.000Z",
						},
						{ id: "lats", name: "Lats", weeklySets: 2, lastTrainedAt: "2026-10-12T09:00:00.000Z" },
						{ id: "neck", name: "Neck", weeklySets: 0, lastTrainedAt: null },
						{
							id: "triceps",
							name: "Triceps",
							weeklySets: null,
							lastTrainedAt: "2026-10-08T09:00:00.000Z",
						},
						{ id: "calves", name: "Calves", weeklySets: null, lastTrainedAt: null },
						{ id: "back", name: "Back", weeklySets: 1, lastTrainedAt: "2026-10-12T09:00:00.000Z" },
					]),
				},
			}),
		);
		expect(decoded).toEqual([
			{ id: "calves", weeklySets: 0, name: "Calves", lastTrainedAt: null },
			{ id: "neck", name: "Neck", weeklySets: 0, lastTrainedAt: null },
			{ id: "triceps", weeklySets: 0, name: "Triceps", lastTrainedAt: "2026-10-08T09:00:00.000Z" },
			{ id: "back", name: "Back", weeklySets: 1, lastTrainedAt: "2026-10-12T09:00:00.000Z" },
			{ id: "lats", name: "Lats", weeklySets: 2, lastTrainedAt: "2026-10-12T09:00:00.000Z" },
			{ id: "chest", name: "Chest", weeklySets: 5, lastTrainedAt: "2026-10-15T09:00:00.000Z" },
		]);
	});

	it("keeps same-name target identities and histories separate", () => {
		expect(
			Result.getOrThrow(
				recipe.decode({
					data: {
						activity: aggregate([
							{
								id: "shared",
								name: "Chest",
								weeklySets: 2,
								lastTrainedAt: "2026-10-15T09:00:00.000Z",
							},
							{
								id: "private",
								name: "Chest",
								weeklySets: 0,
								lastTrainedAt: "2026-10-10T09:00:00.000Z",
							},
						]),
					},
				}),
			),
		).toEqual([
			{ id: "private", name: "Chest", weeklySets: 0, lastTrainedAt: "2026-10-10T09:00:00.000Z" },
			{ id: "shared", name: "Chest", weeklySets: 2, lastTrainedAt: "2026-10-15T09:00:00.000Z" },
		]);
	});
});

describe("recentPersonalBestsRecipe", () => {
	it("returns the newest records with the count of recent ones", () => {
		const decoded = Result.getOrThrow(
			recentPersonalBestsRecipe({ limit: 5, reference, since: "2026-09-21T00:00:00.000Z" }).decode({
				data: {
					recentCount: aggregate([{ count: 3 }]),
					recent: rows([
						{
							reps: 25,
							weight: 30,
							id: "set-1",
							duration: null,
							distance: null,
							exerciseId: "bench",
							exerciseName: "Bench Press",
							exerciseKind: "reps_and_weight",
							personalBests: ["reps", "weight"],
							occurredAt: "2026-10-15T10:00:00.000Z",
						},
					]),
				},
			}),
		);
		expect(decoded.recentCount).toBe(3);
		expect(decoded.items.map(({ exerciseName }) => exerciseName)).toEqual(["Bench Press"]);
	});
});

describe("homeTemplatesRecipe", () => {
	it("flattens exercise ids and the latest linked workout", () => {
		const decoded = Result.getOrThrow(
			homeTemplatesRecipe({ limit: 8, reference }).decode({
				data: {
					templates: rows([
						{
							id: "t1",
							name: "Push",
							exerciseCount: 2,
							schemaSlug: "workout-template",
							exercises: [{ exerciseId: "bench" }, { exerciseId: "press" }],
							lastWorkout: rows([
								{ endedAt: null, activeDuration: 3600, startedAt: "2026-10-15T09:00:00.000Z" },
							]),
						},
						{
							id: "t2",
							name: "Pull",
							exercises: null,
							exerciseCount: 0,
							lastWorkout: rows([]),
							schemaSlug: "workout-template",
						},
					]),
				},
			}),
		);
		expect(
			decoded.map(({ id, exerciseIds, lastWorkout }) => [id, exerciseIds, lastWorkout]),
		).toEqual([
			[
				"t1",
				["bench", "press"],
				{ endedAt: null, activeDuration: 3600, startedAt: "2026-10-15T09:00:00.000Z" },
			],
			["t2", [], null],
		]);
	});
});
