import { describe, expect, it } from "vitest";

import { countMuscleSets } from "../../shared/fitness-metrics";
import { workoutDetails, workoutExercise, workoutSet } from "../../tests/client/workout-fixtures";
import {
	buildExerciseGroups,
	buildTimeline,
	cardMuscleSources,
	summarizeWorkout,
} from "./details-model";

describe("workout details model", () => {
	it("uses each occurrence's retained targets after exercise taxonomy changes", () => {
		const exercise = workoutExercise({
			id: "curl",
			targets: [{ id: "current", role: "primary", name: "Current provider target" }],
			sets: [workoutSet({ exerciseOrder: 0 }), workoutSet({ id: "second", exerciseOrder: 1 })],
		});
		const workout = workoutDetails({ exercises: [exercise] });
		const groups = buildExerciseGroups({
			...workout,
			taxonomy: workout.taxonomy.map((item) =>
				Object.assign({}, item, {
					targets: {
						...item.targets,
						items: [
							{
								id: "recorded",
								name: "Recorded target",
								role: item.exerciseOrder === 0 ? "primary" : "secondary",
							},
						],
					},
				}),
			),
		});
		expect(countMuscleSets(cardMuscleSources(groups))).toEqual([
			{ sets: 1.5, id: "recorded", name: "Recorded target" },
		]);
	});
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
			previousSets: [workoutSet({ reps: 30, weight: 10, volume: 300, exerciseOrder: 2 })],
			sets: [workoutSet({ volume: 350 }), workoutSet({ id: "set-2", setOrder: 1, volume: 375 })],
		});
		const repeated = workoutExercise({
			id: "repeated",
			previousWorkoutStartedAt: "2024-12-17T02:53:12.000Z",
			previousSets: [workoutSet({ reps: 30, weight: 10, volume: 300 })],
			sets: [
				workoutSet({ id: "r-1", exerciseOrder: 1 }),
				workoutSet({ id: "r-2", exerciseOrder: 2 }),
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

	it.each(["pending", "failed"] as const)(
		"leaves a %s weighted occurrence unknown without hiding entered repetitions",
		(recordStatus) => {
			const workout = workoutDetails({
				exercises: [
					workoutExercise({
						previousSets: [workoutSet()],
						previousWorkoutStartedAt: "2024-12-17T02:53:12.000Z",
						sets: [workoutSet(), workoutSet({ recordStatus, volume: null, id: "pending" })],
					}),
				],
			});
			const groups = buildExerciseGroups(workout);
			expect(groups[0]).toMatchObject({ card: { total: null, recordStatus, comparison: null } });
			expect(summarizeWorkout(workout, groups)).toMatchObject({
				sets: 2,
				reps: 20,
				volume: null,
				records: null,
				volumeDelta: null,
			});
			expect(cardMuscleSources(groups)).toEqual([]);
		},
	);

	it.each([0, 100.000001])("retains known weighted volume %s with its canonical unit", (volume) => {
		const groups = buildExerciseGroups(
			workoutDetails({ exercises: [workoutExercise({ sets: [workoutSet({ volume })] })] }),
		);
		expect(groups[0]).toMatchObject({
			card: { total: { value: volume, unit: "kg × repetitions" } },
		});
	});

	it("does not turn a missing ready projection into zero volume", () => {
		const groups = buildExerciseGroups(
			workoutDetails({ exercises: [workoutExercise({ sets: [workoutSet({ volume: null })] })] }),
		);
		expect(groups[0]).toMatchObject({ card: { total: null, comparison: null } });
	});

	it("does not compare against incomplete previous weighted sets", () => {
		const missingStatus = {
			reps: 10,
			weight: 20,
			volume: 200,
			duration: null,
			distance: null,
			exerciseOrder: 0,
		};
		for (const previous of [
			missingStatus,
			workoutSet({ volume: null }),
			workoutSet({ recordStatus: "pending" }),
			workoutSet({ recordStatus: "failed" }),
		]) {
			const groups = buildExerciseGroups(
				workoutDetails({
					exercises: [
						workoutExercise({
							sets: [workoutSet({ volume: 600 })],
							previousSets: [workoutSet(), previous],
							previousWorkoutStartedAt: "2024-12-17T02:53:12.000Z",
						}),
					],
				}),
			);
			expect(groups[0]).toMatchObject({
				card: { comparison: null, total: { value: 600, unit: "kg × repetitions" } },
			});
		}
	});

	it.each([
		{ reps: null, exerciseKind: "reps" },
		{ duration: null, exerciseKind: "duration" },
		{ distance: null, exerciseKind: "distance_and_duration" },
	] as const)("keeps missing entered totals unknown for $exerciseKind", (missing) => {
		const groups = buildExerciseGroups(
			workoutDetails({ exercises: [workoutExercise({ sets: [workoutSet(missing)] })] }),
		);
		expect(groups[0]).toMatchObject({ card: { total: null } });
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
			activeDuration: 600,
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
						{ id: "biceps", name: "Biceps", role: "primary" },
						{ id: "forearms", name: "Forearms", role: "stabilizer" },
					],
				}),
				workoutExercise({
					id: "row",
					sets: [workoutSet({ exerciseOrder: 1 })],
					targets: [
						{ id: "lats", role: null, name: "Lats" },
						{ id: "biceps", name: "Biceps", role: "secondary" },
					],
				}),
			],
		});
		expect(countMuscleSets(cardMuscleSources(buildExerciseGroups(workout)))).toEqual([
			{ sets: 2.5, id: "biceps", name: "Biceps" },
			{ sets: 1, id: "lats", name: "Lats" },
		]);
	});
});
