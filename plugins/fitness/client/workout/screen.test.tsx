import { afterEach, describe, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/client-sdk/effect";
import { disposePluginBridges, mountPluginPage, routeLocation } from "@ryot-app/client-sdk/testing";
import { waitFor } from "@testing-library/dom";

import { workoutDetails, workoutExercise, workoutSet } from "../../tests/client/workout-fixtures";
import { WorkoutDetailsView } from "./screen";

afterEach(disposePluginBridges);

const renderDetails = (workout: Parameters<typeof WorkoutDetailsView>[0]["workout"]) =>
	mountPluginPage(() => <WorkoutDetailsView compact={false} workout={workout} />, {
		location: routeLocation("/"),
	});

describe("workout details view", () => {
	it.live("shows set types, RPE, records, comparisons and supersets for a logged workout", () =>
		Effect.gen(function* () {
			const page = renderDetails(
				workoutDetails({
					supersets: [{ color: "red", exercises: [1, 2] }],
					exercises: [
						workoutExercise({
							id: "row",
							name: "Upright Barbell Row",
							previousWorkoutStartedAt: "2023-03-28T03:00:00.000Z",
							previousSets: [
								{
									reps: 30,
									weight: 15,
									volume: 450,
									duration: null,
									distance: null,
									exerciseOrder: 0,
								},
							],
							sets: [
								workoutSet({ id: "w", reps: 20, weight: 20, volume: 400, setLot: "warm_up" }),
								workoutSet({
									rpe: 8,
									id: "s1",
									reps: 12,
									weight: 30,
									volume: 360,
									setOrder: 1,
									note: "Had a spotter.",
									personalBests: ["weight"],
								}),
							],
						}),
						workoutExercise({
							id: "down",
							name: "Palms-Down Wrist Curl",
							sets: [workoutSet({ id: "d1", exerciseOrder: 1, recordStatus: "pending" })],
						}),
						workoutExercise({
							id: "up",
							name: "Palms-Up Wrist Curl",
							sets: [workoutSet({ id: "u1", exerciseOrder: 2 })],
						}),
					],
				}),
			);
			yield* Effect.promise(() =>
				waitFor(() => expect(page.container?.textContent).toContain("Upright Barbell Row")),
			);
			const text = page.container?.textContent ?? "";

			expect(text).toContain("Repeat workout");
			expect(text).toContain("Superset A");
			expect(text).toContain("A1");
			expect(text).toContain("A2");
			expect(text).toContain("+310 kg vs Mar 28, 2023");
			expect(text).toContain("Updating records…");
			expect(text).toContain("“Had a spotter.”");
			const rowCard = page.container?.querySelector('[data-exercise-id="row"]');
			const setLabels = Array.from(
				rowCard?.querySelectorAll('[role="row"] > [role="cell"]:first-child') ?? [],
			).map((cell) => cell.textContent);
			expect(setLabels).toEqual(["W", "1"]);
			expect(rowCard?.textContent).toContain("RPE");
			expect(rowCard?.querySelector('[data-record="true"]')?.textContent).toContain("Weight");
			expect(page.container?.querySelector('[data-exercise-id="down"]')?.textContent).not.toContain(
				"RPE",
			);
		}),
	);

	it.live("hides the session timeline when sets have no completion times", () =>
		Effect.gen(function* () {
			const page = renderDetails(workoutDetails());
			yield* Effect.promise(() =>
				waitFor(() => expect(page.container?.textContent).toContain("Seated Dumbbell Curl")),
			);
			expect(page.container?.textContent).not.toContain("Session flow");
		}),
	);
});
