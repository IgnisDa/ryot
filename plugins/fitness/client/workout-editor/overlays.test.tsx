import { afterEach, describe, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { disposePluginBridges } from "@ryot-app/plugin-client-sdk/testing";
import { EntityId } from "@ryot-app/plugin-kit/schema";
import { fireEvent, screen, waitFor, within } from "@testing-library/dom";
import { act } from "react";

import type { WorkoutEditorDraft } from "../../shared/workout-editor-draft";
import type { WorkoutPreferenceSettings } from "../../shared/workout-editor-preferences";
import { mountDialogInPluginPage } from "../../tests/client/plugin-page";
import { emptyWorkoutDraft, newWorkoutOccurrence, newWorkoutSet } from "./actions";
import { BulkDeleteOverlay, ReorderOverlay, SupersetOverlay } from "./overlays";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const settings: WorkoutPreferenceSettings = {
	dropRestTime: 0,
	muteSounds: false,
	warmUpRestTime: 0,
	failureRestTime: 0,
	normalRestTime: 60,
	energyUnit: "kcal",
	unitSystem: "metric",
	promptForRestTimer: false,
	startTimerForDurationExercises: true,
};

const occurrence = (id: string, exerciseId: string, setId: string) =>
	newWorkoutOccurrence({
		id,
		setId,
		settings,
		kind: "reps",
		overrides: {},
		exerciseId: EntityId.make(exerciseId),
	});

const workout = () => {
	const squat = occurrence("squat", "exercise-squat", "squat-set-1");
	const press = occurrence("press", "exercise-press", "press-set-1");
	return {
		names: new Map([
			[squat.exerciseId, "Squat"],
			[press.exerciseId, "Press"],
		]),
		draft: {
			...emptyWorkoutDraft({ settings, id: "draft-1", now: "2026-10-16T10:00:00.000Z" }),
			name: "Workout",
			occurrences: [squat, press],
		} satisfies WorkoutEditorDraft,
	};
};

const click = (element: HTMLElement) => {
	void act(() => fireEvent.click(element));
};

afterEach(disposePluginBridges);

describe("workout editor overlays", () => {
	it.effect(
		"confirms bulk deletion, excludes sets in selected exercises, and keeps selection on cancel",
		() =>
			Effect.gen(function* () {
				const { draft, names } = workout();
				const [squat, press] = draft.occurrences;
				if (squat === undefined || press === undefined) {
					throw new Error("Expected two exercise occurrences");
				}
				const currentDraft: WorkoutEditorDraft = {
					...draft,
					occurrences: [
						{ ...squat, sets: [...squat.sets, newWorkoutSet("squat-set-2", "reps")] },
						press,
					],
				};
				const changes: string[] = [];
				const closes: string[] = [];
				const feedback: string[] = [];
				let result = currentDraft;
				yield* mountDialogInPluginPage(() => (
					<BulkDeleteOverlay
						names={names}
						draft={currentDraft}
						onClose={() => closes.push("close")}
						onDeletedSets={() => feedback.push("delete")}
						onChange={(transform) => {
							result = transform(result);
							changes.push("change");
						}}
					/>
				));

				const [squatSet, pressSet] = screen.getAllByRole("checkbox", { name: "Set 1" });
				if (squatSet === undefined || pressSet === undefined) {
					throw new Error("Expected both exercise set checkboxes");
				}
				click(squatSet);
				click(screen.getByRole("checkbox", { name: /Squat.*whole exercise/ }));
				click(pressSet);
				click(screen.getByRole("button", { name: "Delete 2 selected" }));

				const confirmation = screen.getByRole("dialog", { name: "Delete selected items?" });
				expect(
					within(confirmation).getByText("Delete 1 exercise and 1 individual set?"),
				).toBeTruthy();
				click(within(confirmation).getByRole("button", { name: "Cancel" }));
				yield* Effect.promise(() =>
					waitFor(() => expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)),
				);
				expect(changes).toEqual([]);
				expect(closes).toEqual([]);
				expect(feedback).toEqual([]);
				expect(
					screen.getByRole("checkbox", { checked: true, name: /Squat.*whole exercise/ }),
				).toBeTruthy();
				expect(
					within(screen.getByRole("group", { name: "Press" })).getByRole("checkbox", {
						name: "Set 1",
						checked: true,
					}),
				).toBe(pressSet);

				click(screen.getByRole("button", { name: "Delete 2 selected" }));
				click(screen.getByRole("button", { name: "Delete selected" }));

				expect(changes).toEqual(["change"]);
				expect(closes).toEqual(["close"]);
				expect(feedback).toEqual(["delete"]);
				expect(result.occurrences).toHaveLength(1);
				expect(result.occurrences[0]?.clientId).toBe("press");
				expect(result.occurrences[0]?.sets).toEqual([]);
			}),
	);

	it.effect("preselects the initial exercise for bulk deletion", () =>
		Effect.gen(function* () {
			const { draft, names } = workout();
			yield* mountDialogInPluginPage(() => (
				<BulkDeleteOverlay
					draft={draft}
					names={names}
					onClose={() => {}}
					onChange={() => {}}
					onDeletedSets={() => {}}
					initialOccurrenceId="press"
				/>
			));

			expect(
				screen.getByRole("checkbox", { checked: true, name: /Press.*whole exercise/ }),
			).toBeTruthy();
		}),
	);

	it.effect("confirms superset deletion without removing its exercises or sets", () =>
		Effect.gen(function* () {
			const { draft, names } = workout();
			const currentDraft: WorkoutEditorDraft = {
				...draft,
				supersets: [
					{ color: "teal", clientId: "superset-stable-id", occurrenceIds: ["squat", "press"] },
				],
			};
			const changes: string[] = [];
			const closes: string[] = [];
			let result = currentDraft;
			yield* mountDialogInPluginPage(() => (
				<SupersetOverlay
					names={names}
					draft={currentDraft}
					initialOccurrenceId="squat"
					onClose={() => closes.push("close")}
					onChange={(transform) => {
						result = transform(result);
						changes.push("change");
					}}
				/>
			));

			expect(screen.getByText("Editing Superset A")).toBeTruthy();
			expect(screen.getByRole("radio", { name: "Teal", checked: true })).toBeTruthy();
			click(screen.getByRole("button", { name: "Delete Superset A" }));
			const confirmation = screen.getByRole("dialog", { name: "Delete Superset A?" });
			expect(
				within(confirmation).getByText(
					"The superset will be removed. Its exercises and sets will remain in the workout.",
				),
			).toBeTruthy();
			click(within(confirmation).getByRole("button", { name: "Cancel" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)),
			);
			expect(changes).toEqual([]);
			expect(closes).toEqual([]);

			click(screen.getByRole("button", { name: "Delete Superset A" }));
			click(screen.getByRole("button", { name: "Delete superset" }));

			expect(changes).toEqual(["change"]);
			expect(result.supersets).toEqual([]);
			expect(result.occurrences).toEqual(currentDraft.occurrences);
		}),
	);

	it.effect("shows exercise progress and reports the moved occurrence after reordering", () =>
		Effect.gen(function* () {
			const { draft } = workout();
			const [squat, press] = draft.occurrences;
			if (squat === undefined || press === undefined) {
				throw new Error("Expected two exercise occurrences");
			}
			const complete = {
				...occurrence("row", "exercise-row", "row-set"),
				sets: [{ ...newWorkoutSet("row-set", "reps"), included: true }],
			};
			const inProgress = {
				...press,
				sets: [
					...press.sets.map((set) => ({ ...set, included: true })),
					newWorkoutSet("press-set-2", "reps"),
				],
			};
			const reorderDraft: WorkoutEditorDraft = {
				...draft,
				occurrences: [squat, inProgress, complete],
			};
			const reorderNames = new Map([
				[squat.exerciseId, "Squat"],
				[press.exerciseId, "Press"],
				[complete.exerciseId, "Row"],
			]);
			const events: string[] = [];
			let result = reorderDraft;
			yield* mountDialogInPluginPage(() => (
				<ReorderOverlay
					onDrop={() => {}}
					onClose={() => {}}
					onPickUp={() => {}}
					draft={reorderDraft}
					names={reorderNames}
					initialOccurrenceId="row"
					onMoved={(id) => events.push(`moved:${id}`)}
					onChange={(transform) => {
						result = transform(result);
						events.push("change");
					}}
				/>
			));

			expect(screen.getByText("Not started")).toBeTruthy();
			expect(screen.getByText("In progress")).toBeTruthy();
			expect(screen.getByText("Complete")).toBeTruthy();
			expect(screen.getByText("Row").closest("[class~='bg-accent-soft']")).not.toBeNull();
			void act(() =>
				fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Squat" }), {
					key: "ArrowDown",
				}),
			);

			expect(result.occurrences.map(({ clientId }) => clientId)).toEqual(["press", "squat", "row"]);
			expect(events).toEqual(["change", "moved:squat"]);
		}),
	);
});
