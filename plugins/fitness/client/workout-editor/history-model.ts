import type { WorkoutEditorOccurrence, WorkoutEditorSet } from "../../shared/workout-editor-draft";
import type { WorkoutHistorySetResult } from "../../shared/workout-history-recipes";
import { storageWorkoutDisplay } from "../../shared/workout-units";
import { changeOccurrenceDisplay, newWorkoutSet } from "./actions";
import { occurrenceDisplay } from "./draft-ops";

export const historySetForOccurrence = (
	row: WorkoutHistorySetResult["items"][number],
	occurrence: WorkoutEditorOccurrence,
	id: string,
): WorkoutEditorSet | undefined => {
	if (row.recordedKind !== occurrence.exerciseKind) {
		return undefined;
	}
	const set = {
		...newWorkoutSet(id, occurrence.exerciseKind),
		note: row.note ?? undefined,
		setLot: row.setLot ?? "normal",
		rpe: row.rpe === null ? undefined : String(row.rpe),
		reps: row.reps === null ? undefined : String(row.reps),
		weight: row.weight === null ? undefined : String(row.weight),
		duration: row.duration === null ? undefined : String(row.duration),
		distance: row.distance === null ? undefined : String(row.distance),
		restChoice:
			row.restTime === null
				? { kind: "inherited" as const }
				: { kind: "explicit" as const, seconds: String(row.restTime) },
	};
	return changeOccurrenceDisplay(
		{ ...occurrence, sets: [set], display: storageWorkoutDisplay },
		occurrenceDisplay(occurrence),
	).sets[0];
};

export const previousSetIndex = (
	occurrences: readonly WorkoutEditorOccurrence[],
	occurrenceId: string,
	setId: string,
) => {
	const occurrence = occurrences.find(({ clientId }) => clientId === occurrenceId);
	if (occurrence === undefined) {
		return -1;
	}
	let index = 0;
	for (const candidate of occurrences) {
		if (candidate.clientId === occurrenceId) {
			const position = candidate.sets.findIndex(({ clientId }) => clientId === setId);
			return position < 0 ? -1 : index + position;
		}
		if (
			candidate.exerciseId === occurrence.exerciseId &&
			candidate.exerciseKind === occurrence.exerciseKind
		) {
			index += candidate.sets.length;
		}
	}
	return -1;
};
