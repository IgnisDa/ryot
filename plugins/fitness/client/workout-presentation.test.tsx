import { afterEach, describe, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/client-sdk/effect";
import { disposePluginBridges, mountPluginPage, routeLocation } from "@ryot-app/client-sdk/testing";
import { waitFor } from "@testing-library/dom";

import { WorkoutPresentation } from "./workout-presentation";
import type { WorkoutPresentationData } from "./workout-presentation-query";

const reference = {
	name: "Push day",
	entityId: "workout-1",
	ownerPluginId: "fitness",
	entitySchemaSlug: "workout",
	populationStatus: "ready" as const,
	translationStatus: "ready" as const,
};

const workout: WorkoutPresentationData = {
	id: "workout-1",
	name: "Push day",
	setsHasMore: false,
	endedAt: "2026-09-07T09:30:00.000Z",
	startedAt: "2026-09-07T08:00:00.000Z",
	exercises: [
		{
			order: 0,
			id: "exercise-1",
			name: "Bench Press",
			notes: ["Keep your elbows in.", "Control the descent."],
			sets: [
				{
					reps: 8,
					weight: 60,
					id: "set-1",
					setOrder: 0,
					restTime: null,
					duration: null,
					distance: null,
					exerciseOrder: 0,
					confirmedAt: null,
					personalBests: null,
					unitSystem: "metric",
					exerciseId: "exercise-1",
					exerciseName: "Bench Press",
					occurredAt: "2026-09-07T08:10:00.000Z",
				},
			],
		},
	],
};

afterEach(disposePluginBridges);

const renderWorkout = (data: WorkoutPresentationData, compact: boolean) => {
	const page = mountPluginPage(
		() => (
			<WorkoutPresentation
				data={data}
				layout="grid"
				compact={compact}
				viewContext={null}
				reference={reference}
			/>
		),
		{ location: routeLocation("/") },
	);
	return page;
};

describe("workout presentation", () => {
	it.live("renders date, derived duration, stored set summary, and expandable detail", () =>
		Effect.gen(function* () {
			const page = renderWorkout(workout, false);
			yield* Effect.promise(() =>
				waitFor(() => expect(page.container?.textContent).toContain("Push day")),
			);

			expect(page.container?.textContent).toContain("Sep 7, 2026");
			expect(page.container?.textContent).toContain("1h 30m");
			expect(page.container?.textContent).toContain("1 exercise · 1 set");
			expect(page.container?.textContent).toContain("Bench Press");
			expect(page.container?.textContent).toContain("8 reps · 60 kg");
			const exercise = page.container?.querySelector("details > ul > li");
			expect(exercise).not.toBeNull();
			for (const note of ["Keep your elbows in.", "Control the descent."]) {
				const noteParagraphs = Array.from(page.container?.querySelectorAll("p") ?? []).filter(
					(paragraph) => paragraph.textContent.includes(note),
				);
				expect(noteParagraphs).toHaveLength(1);
				expect(noteParagraphs[0]?.closest("li")).toBe(exercise);
			}
			expect(page.container?.querySelector("details")).not.toBeNull();
			expect(page.container?.querySelector("img")).toBeNull();
		}),
	);

	it.live("omits invalid dates, durations, and empty summaries in compact layout", () =>
		Effect.gen(function* () {
			const page = renderWorkout(
				{ ...workout, endedAt: null, exercises: [], startedAt: "invalid" },
				true,
			);
			yield* Effect.promise(() =>
				waitFor(() => expect(page.container?.textContent).toContain("Push day")),
			);

			expect(page.container?.querySelector("time")).toBeNull();
			expect(page.container?.querySelector("details")).toBeNull();
			expect(page.container?.querySelector("article")?.getAttribute("data-compact")).toBe("true");
			expect(page.container?.textContent).not.toContain("exercise");
		}),
	);
});
