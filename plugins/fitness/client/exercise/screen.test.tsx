import { afterEach, describe, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/client-sdk/effect";
import { disposePluginBridges, mountPluginPage, routeLocation } from "@ryot-app/client-sdk/testing";
import { waitFor } from "@testing-library/dom";

import { emptyTotals, exerciseDetails, exerciseRecord } from "../../tests/client/exercise-fixtures";
import { ExerciseDetailsView } from "./screen";

afterEach(disposePluginBridges);

const renderDetails = (details: ReturnType<typeof exerciseDetails>) =>
	mountPluginPage(
		() => (
			<ExerciseDetailsView
				timeZone="UTC"
				compact={false}
				details={details}
				onNotesChanged={() => undefined}
				now={new Date("2026-10-12T00:00:00.000Z")}
				exercise={details.exercise ?? exerciseRecord()}
			/>
		),
		{ location: routeLocation("/") },
	);

const mounted = (details: ReturnType<typeof exerciseDetails>) =>
	Effect.gen(function* () {
		const page = renderDetails(details);
		yield* Effect.promise(() =>
			waitFor(() =>
				expect(page.container?.querySelector("h1")?.textContent).toBe(details.exercise?.name),
			),
		);
		return page.container;
	});

const performedTotals = {
	...emptyTotals,
	sets: 4,
	reps: 40,
	sessions: 2,
	volume: 3200,
	warmUpSets: 1,
	failureSets: 1,
	weightForReps5: 80,
	weightForReps1: 100,
	lastAt: "2026-10-05T10:00:00.000Z",
	firstAt: "2026-01-05T10:00:00.000Z",
};

describe("exercise details view", () => {
	it.live("shows history, sessions, personal bests and notes for a performed weight exercise", () =>
		Effect.gen(function* () {
			const container = yield* mounted(
				exerciseDetails({
					totals: performedTotals,
					exercise: exerciseRecord({
						instructions: ["Lie back on the bench."],
						targets: [
							{ name: "Chest", role: "primary" },
							{ name: "Triceps", role: "secondary" },
						],
					}),
					months: [
						{
							reps: 20,
							sessions: 1,
							maxReps: 10,
							volume: 1600,
							maxOneRm: 93,
							maxPace: null,
							maxWeight: 80,
							duration: null,
							distance: null,
							maxDuration: null,
							month: "2026-10-01T00:00:00.000Z",
						},
					],
					notes: [
						{
							rating: 80,
							id: "note-1",
							updatedAt: "2026-10-05T10:00:00.000Z",
							occurredAt: "2026-10-05T10:00:00.000Z",
							text: "Keep elbows tucked.\nBreathe out.",
						},
						{
							text: null,
							id: "note-2",
							rating: null,
							updatedAt: "2026-10-04T10:00:00.000Z",
							occurredAt: "2026-10-04T10:00:00.000Z",
						},
					],
					sessions: [
						{
							endedAt: null,
							id: "workout-1",
							name: "Push day",
							startedAt: "2026-10-05T09:00:00.000Z",
							sets: {
								pageInfo: { limit: 100, hasMore: false },
								items: [
									{
										id: "s1",
										reps: 10,
										weight: 40,
										setOrder: 0,
										duration: null,
										distance: null,
										setLot: "warm_up",
									},
									{
										reps: 3,
										id: "s2",
										weight: 80,
										setOrder: 1,
										duration: null,
										distance: null,
										setLot: "failure",
									},
								],
							},
						},
					],
				}),
			);
			const text = container?.textContent ?? "";

			expect(text).toContain("Your history");
			expect(text).toContain("Best weight by rep count");
			expect(text).toContain("Push day");
			expect(text).toContain("Primary");
			expect(text).toContain("Secondary");
			expect(text).toContain("Empty note");
			expect(container?.querySelector("header")?.textContent).not.toContain("Edit");
			expect(text).toContain("Start workout");
			expect(container?.querySelector('[data-set-lot="warm_up"]')?.textContent).toContain(
				"Warm-up",
			);
			expect(container?.querySelector('[data-set-lot="failure"]')?.textContent).toContain("Fail");
			expect(container?.querySelector('[aria-label="Rated 4 of 5"]')).not.toBeNull();
			expect(container?.querySelector("p.whitespace-pre-wrap")?.textContent).toBe(
				"Keep elbows tucked.\nBreathe out.",
			);
		}),
	);

	it.live("puts instructions before an empty history card when never performed", () =>
		Effect.gen(function* () {
			const container = yield* mounted(
				exerciseDetails({ exercise: exerciseRecord({ instructions: ["Hold the kettlebell."] }) }),
			);
			const text = container?.textContent ?? "";

			expect(text).toContain("You haven't logged this exercise yet.");
			expect(text.indexOf("How to perform")).toBeLessThan(text.indexOf("Your history"));
			expect(text).not.toContain("Recent sessions");
			expect(text).not.toContain("Best weight by rep count");
		}),
	);

	it.live("offers Edit and the empty states only for a custom exercise", () =>
		Effect.gen(function* () {
			const custom = yield* mounted(
				exerciseDetails({ exercise: exerciseRecord({ userId: "user-1", kind: "duration" }) }),
			);
			const customText = custom?.textContent ?? "";

			expect(custom?.querySelector("header")?.textContent).toContain("Edit");
			expect(customText).toContain("No muscles tagged yet.");
			expect(customText).toContain("You haven't written instructions");

			const provider = yield* mounted(exerciseDetails());
			expect(provider?.querySelector("header")?.textContent).not.toContain("Edit");
			expect(provider?.textContent).not.toContain("No muscles tagged yet.");
		}),
	);

	it.live("renders roleless targets as one group", () =>
		Effect.gen(function* () {
			const container = yield* mounted(
				exerciseDetails({
					exercise: exerciseRecord({
						targets: [
							{ role: null, name: "Lats" },
							{ role: null, name: "Biceps" },
						],
					}),
				}),
			);
			const text = container?.textContent ?? "";

			expect(text).toContain("Lats");
			expect(text).toContain("Biceps");
			expect(text).not.toContain("Primary");
			expect(text).not.toContain("Secondary");
		}),
	);
});
