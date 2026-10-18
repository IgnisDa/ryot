import { describe, expect, it } from "@effect/vitest";

import { exerciseRecord } from "../../tests/client/exercise-fixtures";
import {
	buildMonthSeries,
	dedupeWorkoutNotes,
	groupTargets,
	isCustomExercise,
	latestPersonalBests,
	metricsForKind,
	type PersonalBestRow,
	ratingToStars,
	starsToRating,
} from "./details-model";

const month = (iso: string, maxWeight: number | null) => ({
	maxWeight,
	reps: null,
	month: iso,
	sessions: 1,
	volume: null,
	maxReps: null,
	maxPace: null,
	maxOneRm: null,
	duration: null,
	distance: null,
	maxDuration: null,
});

const personalBest = (
	id: string,
	occurredAt: string,
	personalBests: PersonalBestRow["personalBests"],
): PersonalBestRow => ({
	id,
	reps: 5,
	occurredAt,
	oneRm: null,
	weight: 100,
	volume: null,
	personalBests,
	duration: null,
	distance: null,
	workoutId: "w",
	workoutName: "W",
	workoutStartedAt: null,
});

const keys = (kind: Parameters<typeof metricsForKind>[0]) =>
	metricsForKind(kind).map((metric) => metric.key);

const heaviestWeight = () => {
	const metric = metricsForKind("reps_and_weight")[1];
	if (metric === undefined) {
		throw new Error("missing metric");
	}
	return metric;
};

describe("exercise details model", () => {
	it("offers metrics by exercise kind", () => {
		expect(keys("reps_and_weight")).toEqual(["oneRm", "maxWeight", "volume"]);
		expect(keys("distance_and_duration")).toEqual(["distance", "duration", "pace"]);
		expect(keys("duration")).toEqual(["duration", "maxDuration", "sessions"]);
		expect(keys(null)).toEqual(["sessions"]);
	});

	it("limits the series to the range and includes empty months", () => {
		const metric = heaviestWeight();
		const input = {
			metric,
			timeZone: "UTC",
			now: new Date("2026-10-12T00:00:00.000Z"),
			months: [month("2023-01-01T00:00:00.000Z", 60), month("2026-08-01T00:00:00.000Z", 80)],
		};

		const year = buildMonthSeries({ ...input, range: "1y" });
		const threeYears = buildMonthSeries({ ...input, range: "3y" });
		const all = buildMonthSeries({ ...input, range: "all" });

		expect(year.map((point) => point.label).at(0)).toBe("Nov 2025");
		expect(year).toHaveLength(12);
		expect(year.filter((point) => point.value !== null).map((point) => point.value)).toEqual([80]);
		expect(threeYears).toHaveLength(36);
		expect(all).toHaveLength(46);
		expect(all.at(0)).toMatchObject({ value: 60, label: "Jan 2023" });
		expect(all.at(-1)).toMatchObject({ value: null, label: "Oct 2026" });
		expect(buildMonthSeries({ ...input, months: [], range: "all" })).toEqual([]);
	});

	it("buckets months in the caller's time zone", () => {
		const metric = heaviestWeight();
		const [point] = buildMonthSeries({
			metric,
			range: "all",
			timeZone: "Pacific/Auckland",
			now: new Date("2026-06-15T00:00:00.000Z"),
			months: [month("2026-05-31T12:00:00.000Z", 90)],
		});

		expect(point).toMatchObject({ value: 90, label: "Jun 2026" });
	});

	it("keeps the newest set for each badge type", () => {
		const entries = latestPersonalBests([
			personalBest("old", "2024-01-01T00:00:00.000Z", ["weight", "reps"]),
			personalBest("new", "2025-01-01T00:00:00.000Z", ["weight"]),
		]);

		expect(entries.map(({ row, type }) => [type, row.id])).toEqual([
			["weight", "new"],
			["reps", "old"],
		]);
	});

	it("merges repeated workout notes with a count and the latest date", () => {
		const notes = dedupeWorkoutNotes(
			[
				{
					id: "a",
					setOrder: 0,
					workoutId: "w1",
					workoutName: "Push",
					note: "Needed spotter.",
					workoutStartedAt: "2024-01-01T00:00:00.000Z",
				},
				{
					id: "b",
					setOrder: 1,
					workoutId: "w2",
					workoutName: "Push",
					note: " Needed spotter. ",
					workoutStartedAt: "2025-01-01T00:00:00.000Z",
				},
			],
			[
				{
					id: "w3",
					name: "Chest",
					exerciseOrder: 1,
					startedAt: "2023-01-01T00:00:00.000Z",
					exerciseNotes: [
						{ exerciseOrder: 1, notes: ["Keep legs off the ground."] },
						{ exerciseOrder: 2, notes: ["Another exercise."] },
					],
				},
			],
		);

		expect(notes).toEqual([
			{
				count: 2,
				source: "Set note",
				text: "Needed spotter.",
				latestAt: "2025-01-01T00:00:00.000Z",
			},
			{
				count: 1,
				source: "Chest",
				text: "Keep legs off the ground.",
				latestAt: "2023-01-01T00:00:00.000Z",
			},
		]);
	});

	it("maps ratings between stars and stored values", () => {
		expect(ratingToStars(80)).toBe(4);
		expect(ratingToStars(100)).toBe(5);
		expect(ratingToStars(50)).toBe(3);
		expect(ratingToStars(0)).toBeNull();
		expect(ratingToStars(null)).toBeNull();
		expect(starsToRating(3)).toBe(60);
	});

	it("groups targets by role only when roles exist", () => {
		expect(
			groupTargets([
				{ role: null, name: "Lats" },
				{ role: null, name: "Biceps" },
			]),
		).toEqual([{ label: null, names: ["Lats", "Biceps"] }]);
		expect(
			groupTargets([
				{ name: "Chest", role: "primary" },
				{ name: "Triceps", role: "secondary" },
			]).map((group) => group.label),
		).toEqual(["Primary", "Secondary"]);
	});

	it("treats an exercise with an owner as custom", () => {
		expect(isCustomExercise(exerciseRecord({ userId: "user-1" }))).toBe(true);
		expect(isCustomExercise(exerciseRecord())).toBe(false);
	});
});
