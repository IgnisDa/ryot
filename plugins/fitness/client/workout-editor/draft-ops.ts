import type {
	WorkoutEditorDisplay,
	WorkoutEditorDraft,
	WorkoutEditorOccurrence,
	WorkoutEditorSet,
} from "../../shared/workout-editor-draft";
import {
	resolveWorkoutRestTime,
	type WorkoutExerciseOverrides,
	type WorkoutRestSettings,
} from "../../shared/workout-editor-preferences";
import { durationDisplayUnit, storageWorkoutDisplay } from "../../shared/workout-units";

type Superset = WorkoutEditorDraft["supersets"][number];

export type DraftChange = (transform: (draft: WorkoutEditorDraft) => WorkoutEditorDraft) => void;

const defaultOccurrenceDisplay: WorkoutEditorDisplay = {
	...storageWorkoutDisplay,
	durationUnit: durationDisplayUnit(),
};

export const occurrenceDisplay = (occurrence: WorkoutEditorOccurrence) =>
	occurrence.display ?? defaultOccurrenceDisplay;

export const resolveSetRestTime = (
	set: Pick<WorkoutEditorSet, "restChoice" | "setLot">,
	settings: Partial<WorkoutRestSettings>,
	overrides: WorkoutExerciseOverrides,
) =>
	resolveWorkoutRestTime({
		settings,
		overrides,
		lot: set.setLot,
		explicitSeconds: set.restChoice.kind === "explicit" ? set.restChoice.seconds : undefined,
	});

export const updateOccurrence = (
	draft: WorkoutEditorDraft,
	id: string,
	change: (occurrence: WorkoutEditorOccurrence) => WorkoutEditorOccurrence,
): WorkoutEditorDraft => {
	const occurrences = draft.occurrences.map((occurrence) =>
		occurrence.clientId === id ? change(occurrence) : occurrence,
	);
	return occurrences.every((occurrence, index) => occurrence === draft.occurrences[index])
		? draft
		: { ...draft, occurrences };
};

export const updateSet = (
	draft: WorkoutEditorDraft,
	occurrenceId: string,
	setId: string,
	change: (set: WorkoutEditorSet) => WorkoutEditorSet,
) =>
	updateOccurrence(draft, occurrenceId, (occurrence) => ({
		...occurrence,
		sets: occurrence.sets.map((set) => (set.clientId === setId ? change(set) : set)),
	}));

export const isTemplateDraft = (draft: WorkoutEditorDraft) =>
	draft.mode.kind === "template-create" || draft.mode.kind === "template-edit";

export const supersetOf = (draft: WorkoutEditorDraft, occurrenceId: string) =>
	draft.supersets.find(({ occurrenceIds }) => occurrenceIds.includes(occurrenceId));

export const supersetOrderedIds = (draft: WorkoutEditorDraft, group: Superset) =>
	draft.occurrences
		.filter(({ clientId }) => group.occurrenceIds.includes(clientId))
		.map(({ clientId }) => clientId);

export const pruneSupersets = (
	supersets: WorkoutEditorDraft["supersets"],
	keep: (occurrenceId: string) => boolean,
): WorkoutEditorDraft["supersets"] =>
	supersets.flatMap((group) => {
		const occurrenceIds = group.occurrenceIds.filter(keep);
		return occurrenceIds.length < 2 ? [] : [{ ...group, occurrenceIds }];
	});

export const focusOccurrence = (
	draft: WorkoutEditorDraft,
	occurrenceId: string | undefined,
	setId?: string,
): WorkoutEditorDraft => ({
	...draft,
	activeSetId: setId,
	activeOccurrenceId: occurrenceId,
	occurrences: draft.occurrences.map((occurrence) =>
		occurrence.clientId === occurrenceId ? { ...occurrence, isCollapsed: false } : occurrence,
	),
});
