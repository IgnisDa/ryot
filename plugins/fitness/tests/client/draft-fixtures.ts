import { Schema } from "@ryot-app/plugin-kit/effect";
import { EntityId } from "@ryot-app/plugin-kit/schema";

import { emptyWorkoutDraft, newWorkoutOccurrence } from "../../client/workout-editor/actions";
import type { ExerciseKind } from "../../shared/exercise-kinds";
import type {
	WorkoutEditorDraft,
	WorkoutEditorOccurrence,
	WorkoutEditorSet,
} from "../../shared/workout-editor-draft";
import { WorkoutPreferenceSettingsSchema } from "../../shared/workout-editor-preferences";

export const startTime = "2026-10-15T10:00:00.000Z";

export const preferenceSettings = Schema.decodeSync(WorkoutPreferenceSettingsSchema)({
	dropRestTime: 0,
	muteSounds: false,
	warmUpRestTime: 0,
	failureRestTime: 0,
	normalRestTime: 60,
	energyUnit: "kcal",
	unitSystem: "metric",
	promptForRestTimer: false,
	startTimerForDurationExercises: true,
});

export const liveDraft = (overrides: Partial<WorkoutEditorDraft> = {}): WorkoutEditorDraft => ({
	...emptyWorkoutDraft({ id: "draft-1", now: startTime, settings: preferenceSettings }),
	name: "Session",
	...overrides,
});

export const exerciseOccurrence = (
	kind: ExerciseKind,
	set: Partial<WorkoutEditorSet> = {},
	overrides: Partial<WorkoutEditorOccurrence> = {},
): WorkoutEditorOccurrence => {
	const occurrence = newWorkoutOccurrence({
		kind,
		overrides: {},
		setId: "set-1",
		id: "occurrence-1",
		settings: preferenceSettings,
		exerciseId: EntityId.make("exercise-1"),
	});
	return {
		...occurrence,
		...overrides,
		sets: occurrence.sets.map((candidate) => Object.assign({}, candidate, set)),
	};
};
