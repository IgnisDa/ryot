import { describe, expect, it } from "vitest";

import { workoutDetails, workoutExercise, workoutSet } from "../../tests/client/workout-fixtures";
import {
	buildExerciseGroups,
	buildTimeline,
	countMuscleSets,
	setLabels,
	summarizeWorkout,
} from "./details-model";

describe("workout details model", () => {
	it("splits an exercise done twice into ordered cards and groups supersets", () => {
		const curl = workoutExercise({
			id: "curl",
			sets: [
				workoutSet({ id: "curl-a", exerciseOrder: 0 }),
				workoutSet({ id: "curl-b", exerciseOrder: 3 }),
			],
		});
		const row = workoutExercise({
			id: "row",
			sets: [workoutSet({ id: "row-a", exerciseOrder: 1 })],
		});
		const wrist = workoutExercise({
			id: "wrist",
			sets: [workoutSet({ id: "wrist-a", exerciseOrder: 2 })],
		});
		const groups = buildExerciseGroups(
			workoutDetails({
				exercises: [wrist, curl, row],
				supersets: [{ color: "red", exercises: [2, 1] }],
				exerciseNotes: [{ exerciseOrder: 3, notes: ["Slow negatives."] }],
			}),
		);

		expect(groups.map((group) => group.kind)).toEqual(["single", "superset", "single"]);
		const superset = groups[1];
		expect(superset?.kind === "superset" && superset.cards.map((card) => card.supersetTag)).toEqual(
			["A1", "A2"],
		);
		const last = groups[2];
		expect(last?.kind === "single" && last.card.key).toBe("3:curl");
		expect(last?.kind === "single" && last.card.notes).toEqual(["Slow negatives."]);
	});

	it("compares against the previous session only for exercises done once", () => {
		const compared = workoutExercise({
			id: "single",
			previousWorkoutStartedAt: "2024-12-17T02:53:12.000Z",
			sets: [workoutSet({ volume: 350 }), workoutSet({ id: "set-2", setOrder: 1, volume: 375 })],
			previousSets: [
				{ reps: 30, weight: 10, volume: 300, duration: null, distance: null, exerciseOrder: 2 },
			],
		});
		const repeated = workoutExercise({
			id: "repeated",
			previousWorkoutStartedAt: "2024-12-17T02:53:12.000Z",
			sets: [
				workoutSet({ id: "r-1", exerciseOrder: 1 }),
				workoutSet({ id: "r-2", exerciseOrder: 2 }),
			],
			previousSets: [
				{ reps: 30, weight: 10, volume: 300, duration: null, distance: null, exerciseOrder: 0 },
			],
		});
		const workout = workoutDetails({ exercises: [compared, repeated] });
		const groups = buildExerciseGroups(workout);
		const comparisons = groups.flatMap((group) =>
			group.kind === "single" ? [[group.card.exercise.id, group.card.comparison?.delta]] : [],
		);

		expect(comparisons).toEqual([
			["single", 425],
			["repeated", undefined],
			["repeated", undefined],
		]);
		expect(summarizeWorkout(workout, groups).volumeDelta).toBe(425);
	});

	it("letters warm-up, drop and failure sets and numbers only the others", () => {
		expect(
			setLabels([
				workoutSet({ setLot: "warm_up" }),
				workoutSet({ setLot: "normal" }),
				workoutSet({ setLot: "drop" }),
				workoutSet({ setLot: "normal" }),
				workoutSet({ setLot: "failure" }),
			]),
		).toEqual(["W", "1", "D", "2", "F"]);
	});

	it("summarises totals, records and rest across all sets", () => {
		const workout = workoutDetails({
			exercises: [
				workoutExercise({
					sets: [
						workoutSet({ reps: 10, volume: 200, restTime: 60, personalBests: ["reps", "volume"] }),
						workoutSet({ reps: 8, id: "set-2", volume: 160, restTime: null }),
					],
				}),
			],
		});
		expect(summarizeWorkout(workout, buildExerciseGroups(workout))).toEqual({
			sets: 2,
			reps: 18,
			records: 2,
			volume: 360,
			exercises: 1,
			recordSets: 1,
			restSeconds: 60,
			volumeDelta: null,
			durationSeconds: 5108,
		});
	});

	it("builds the session timeline only when every group has completion times inside the workout", () => {
		const timed = workoutDetails({
			endedAt: "2024-12-24T03:00:00.000Z",
			startedAt: "2024-12-24T02:00:00.000Z",
			exercises: [
				workoutExercise({
					id: "first",
					sets: [workoutSet({ confirmedAt: "2024-12-24T02:20:00.000Z" })],
				}),
				workoutExercise({
					id: "second",
					name: "Cable Rear Delt Fly",
					sets: [workoutSet({ exerciseOrder: 1, confirmedAt: "2024-12-24T02:50:00.000Z" })],
				}),
			],
		});
		const timeline = buildTimeline(timed, buildExerciseGroups(timed), 600);
		expect(timeline?.segments.map(({ label, seconds }) => [label, seconds])).toEqual([
			["Seated Dumbbell Curl", 1200],
			["Cable Rear Delt Fly", 1800],
		]);
		expect(timeline?.workingSeconds).toBe(3000);

		const untimed = workoutDetails({
			exercises: [workoutExercise({ sets: [workoutSet({ confirmedAt: null })] })],
		});
		expect(buildTimeline(untimed, buildExerciseGroups(untimed), 0)).toBeNull();

		const outside = workoutDetails({
			endedAt: "2024-12-24T03:00:00.000Z",
			startedAt: "2024-12-24T02:00:00.000Z",
			exercises: [
				workoutExercise({ sets: [workoutSet({ confirmedAt: "2024-12-24T04:00:00.000Z" })] }),
			],
		});
		expect(buildTimeline(outside, buildExerciseGroups(outside), 0)).toBeNull();
	});

	it("counts sets per muscle while ignoring stabilizers", () => {
		const workout = workoutDetails({
			exercises: [
				workoutExercise({
					sets: [workoutSet(), workoutSet({ id: "set-2" })],
					targets: [
						{ name: "Biceps", role: "primary" },
						{ name: "Forearms", role: "stabilizer" },
					],
				}),
				workoutExercise({
					id: "row",
					sets: [workoutSet({ exerciseOrder: 1 })],
					targets: [
						{ role: null, name: "Lats" },
						{ name: "Biceps", role: "secondary" },
					],
				}),
			],
		});
		expect(countMuscleSets(buildExerciseGroups(workout))).toEqual([
			{ sets: 3, name: "Biceps" },
			{ sets: 1, name: "Lats" },
		]);
	});
});
