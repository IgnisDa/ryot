import { Result } from "@ryot-app/plugin-kit/effect";
import { describe, expect, it } from "vitest";

import { decodeWorkoutPresentation } from "./entity-presentations";

const rows = (items: readonly Record<string, unknown>[], hasMore = false) => ({
	items,
	type: "rows",
	pageInfo: { hasMore, limit: 100, nextCursor: hasMore ? "next-page" : null },
});

const set = (
	id: string,
	exerciseId: string,
	exerciseName: string,
	exerciseOrder: number,
	setOrder: number,
	reps: number,
) => ({
	id,
	reps,
	setOrder,
	exerciseId,
	weight: 60,
	exerciseName,
	exerciseOrder,
	duration: null,
	distance: null,
});

describe("workout presentation source", () => {
	it("decodes nested sets and groups repeated exercise occurrences by order", () => {
		const decoded = Result.getOrThrow(
			decodeWorkoutPresentation({
				presentationId: "workout-1",
				presentationName: "Push day",
				presentationEndedAt: "2026-09-07T09:30:00.000Z",
				presentationStartedAt: "2026-09-07T08:00:00.000Z",
				presentationExerciseNotes: [
					{ exerciseOrder: 0, notes: ["Brace before each rep."] },
					{ exerciseOrder: 2, notes: ["Pause at the top."] },
				],
				presentationSets: rows(
					[
						set("set-1", "exercise-1", "Bench Press", 0, 1, 6),
						set("set-2", "exercise-2", "Incline Press", 1, 0, 10),
						set("set-3", "exercise-1", "Bench Press", 0, 0, 8),
						set("set-4", "exercise-1", "Bench Press", 2, 0, 5),
					],
					true,
				),
			}),
		);

		expect(decoded).toEqual({
			name: "Push day",
			presentationId: "workout-1",
			endedAt: "2026-09-07T09:30:00.000Z",
			startedAt: "2026-09-07T08:00:00.000Z",
			exercises: [
				expect.objectContaining({
					order: 0,
					id: "exercise-1",
					name: "Bench Press",
					notes: ["Brace before each rep."],
					sets: [
						expect.objectContaining({ reps: 6, setOrder: 1 }),
						expect.objectContaining({ reps: 8, setOrder: 0 }),
					],
				}),
				expect.objectContaining({
					order: 1,
					notes: [],
					id: "exercise-2",
					name: "Incline Press",
					sets: [expect.objectContaining({ reps: 10, setOrder: 0 })],
				}),
				expect.objectContaining({
					order: 2,
					id: "exercise-1",
					name: "Bench Press",
					notes: ["Pause at the top."],
					sets: [expect.objectContaining({ reps: 5, setOrder: 0 })],
				}),
			],
		});
	});
});
