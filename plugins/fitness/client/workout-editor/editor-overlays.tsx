import { Button, Dialog, MotionPresence } from "@ryot-app/plugin-ui-sdk";

import type { WorkoutEditorContextOutputSchema } from "../../shared/workout-editor-context-operations";
import type { WorkoutEditorDraft } from "../../shared/workout-editor-draft";
import { MeasurementDialogs, type useMeasurementLogger } from "../measurements/measurement-logger";
import { changeOccurrenceDisplay, removeWorkoutItems } from "./actions";
import { isWorkoutEditorSaving, type WorkoutEditorControllerSnapshot } from "./controller-types";
import { updateOccurrence } from "./draft-ops";
import type { ExerciseSheet } from "./exercise-card";
import { ExercisePicker } from "./exercise-picker";
import { ExerciseNotesSheet } from "./instructions";
import { WorkoutMediaOverlay } from "./media";
import { removeDraftMedia, type WorkoutMediaTarget } from "./media-state";
import {
	BulkDeleteOverlay,
	HistoryOverlay,
	HistoryRequiresPro,
	ReorderOverlay,
	SupersetOverlay,
} from "./overlays";
import { UnitsAndDefaultsSheet } from "./preferences";
import type { EditorExercise } from "./queries";
import type { useEditorActions } from "./use-editor-actions";
import type { useWorkoutEditor } from "./use-workout-editor";
import {
	ConfirmDialog,
	FinishReview,
	WorkoutDetailsSheet,
	WorkoutPreferencesSheet,
} from "./workout-sheets";

type OverlayKind =
	| Exclude<ExerciseSheet, "attachments">
	| "bulk-delete"
	| "delete-exercise"
	| "details"
	| "discard"
	| "finish"
	| "picker"
	| "preferences"
	| "reload"
	| "reorder"
	| "supersets";

export type EditorOverlay =
	OverlayKind | { readonly occurrenceId: string; readonly kind: OverlayKind };

export function EditorOverlays(props: {
	readonly now: number;
	readonly locked: boolean;
	readonly disabled: boolean;
	readonly requestBlocked: boolean;
	readonly requestHandled: boolean;
	readonly existingGuard: boolean;
	readonly onClose: () => void;
	readonly onFinishRequest: () => void;
	readonly mediaLabel: string;
	readonly names: ReadonlyMap<string, string>;
	readonly overlay: EditorOverlay | undefined;
	readonly draft: WorkoutEditorDraft | undefined;
	readonly mediaTarget: WorkoutMediaTarget | undefined;
	readonly exercises: readonly EditorExercise[] | undefined;
	readonly refetchExercises: () => void;
	readonly onCloseMedia: () => void;
	readonly onDiscarded: () => void;
	readonly onReloaded: () => void;
	readonly onSave: () => void;
	readonly scrollTo: (id: string) => void;
	readonly snapshot: WorkoutEditorControllerSnapshot;
	readonly actions: ReturnType<typeof useEditorActions>;
	readonly measurement: ReturnType<typeof useMeasurementLogger>;
	readonly controller: ReturnType<typeof useWorkoutEditor>["controller"];
	readonly context: typeof WorkoutEditorContextOutputSchema.Type | undefined;
}) {
	const { draft, actions, context, onClose, overlay, snapshot, exercises, controller } = props;
	const kind = typeof overlay === "string" ? overlay : overlay?.kind;
	const occurrenceId = typeof overlay === "object" ? overlay.occurrenceId : undefined;
	const currentOccurrence = draft?.occurrences.find(({ clientId }) => clientId === occurrenceId);
	const currentExercise = exercises?.find(({ id }) => id === currentOccurrence?.exerciseId);
	const exerciseName = currentExercise?.name ?? "Unavailable exercise";
	const pro = context?.proAvailable === true;
	const { mediaTarget } = props;
	const live = draft === undefined || draft.mode.kind === "live";
	const replacing = kind === "replace" ? currentOccurrence : undefined;
	return (
		<MotionPresence>
			<MeasurementDialogs
				key="measurements"
				onClose={props.measurement.close}
				dialog={props.measurement.dialog}
				trigger={props.measurement.trigger}
			/>
			{props.requestBlocked && !props.requestHandled ? (
				<Dialog
					size="sm"
					closeIcon={null}
					key="requires-pro"
					title="Templates require Pro"
					closeLabel="Return to editor"
					onClose={props.onFinishRequest}
					description="Your current draft hasn't changed."
					footer={
						<Button onClick={props.onFinishRequest}>
							{draft === undefined ? "Return to editor" : "Resume draft"}
						</Button>
					}
				/>
			) : null}
			{mediaTarget !== undefined && draft !== undefined && snapshot.status === "ready" ? (
				<WorkoutMediaOverlay
					key="media"
					draft={draft}
					target={mediaTarget}
					disabled={props.locked}
					label={props.mediaLabel}
					onClose={props.onCloseMedia}
					uploading={snapshot.uploading}
					canUpload={mediaTarget.kind !== "workout" || pro}
					onUpload={(uploadKind, file) => controller.uploadMedia(mediaTarget, uploadKind, file)}
					onRemove={(removeKind, asset) =>
						actions.change((current) => removeDraftMedia(current, mediaTarget, removeKind, asset))
					}
				/>
			) : null}
			{props.existingGuard && draft !== undefined ? (
				<Dialog
					size="sm"
					closeIcon={null}
					key="existing-draft"
					onClose={props.onFinishRequest}
					title="You have a workout in progress"
					closeLabel="Resume workout in progress"
					footer={
						<>
							<Button
								variant="dangerGhost"
								disabled={props.disabled}
								onClick={() => actions.run(controller.discard())}
							>
								Discard and start
							</Button>
							<Button onClick={props.onFinishRequest}>Resume workout</Button>
						</>
					}
					description={
						<>
							{draft.name} ·{" "}
							{
								draft.occurrences.flatMap(({ sets }) => sets).filter(({ included }) => included)
									.length
							}{" "}
							of {draft.occurrences.flatMap(({ sets }) => sets).length} sets done. Resume it, or
							discard it to start the requested workout.
							{props.disabled ? " Finish the pending save before starting another workout." : ""}
						</>
					}
				/>
			) : null}
			{kind === "picker" || replacing !== undefined ? (
				<ExercisePicker
					key="picker"
					onClose={onClose}
					onApply={(selected) => actions.applyExercises(selected, replacing)}
					{...(replacing === undefined
						? {}
						: {
								replacement: {
									kind: replacing.exerciseKind,
									name: currentExercise?.name ?? "exercise",
								},
							})}
				/>
			) : null}
			{kind === "details" && draft !== undefined ? (
				<WorkoutDetailsSheet
					key="details"
					draft={draft}
					onClose={onClose}
					disabled={props.locked}
					onChange={actions.change}
				/>
			) : null}
			{kind === "preferences" && actions.local !== undefined ? (
				<WorkoutPreferencesSheet
					pro={pro}
					key="preferences"
					onClose={onClose}
					disabled={props.locked}
					onChange={actions.change}
					preferences={actions.local}
				/>
			) : null}
			{kind === "reorder" && draft !== undefined ? (
				<ReorderOverlay
					key="reorder"
					draft={draft}
					onClose={onClose}
					names={props.names}
					onChange={actions.change}
					initialOccurrenceId={occurrenceId}
					onPickUp={() => actions.hapticFeedback("impact")}
					onDrop={() => actions.hapticFeedback("selection")}
					onMoved={(id) => {
						onClose();
						props.scrollTo(`occurrence-${id}`);
					}}
				/>
			) : null}
			{kind === "bulk-delete" && draft !== undefined ? (
				<BulkDeleteOverlay
					draft={draft}
					key="bulk-delete"
					onClose={onClose}
					names={props.names}
					onChange={actions.change}
					initialOccurrenceId={occurrenceId}
					onDeletedSets={() => actions.feedback("delete-set")}
				/>
			) : null}
			{kind === "supersets" && draft !== undefined ? (
				<SupersetOverlay
					draft={draft}
					key="supersets"
					onClose={onClose}
					names={props.names}
					onChange={actions.change}
					initialOccurrenceId={occurrenceId}
				/>
			) : null}
			{kind === "defaults" && currentExercise !== undefined && currentOccurrence !== undefined ? (
				<UnitsAndDefaultsSheet
					key="defaults"
					onClose={onClose}
					exercise={currentExercise}
					occurrence={currentOccurrence}
					onSaved={props.refetchExercises}
					onDisplay={(display) =>
						actions.change((current) =>
							updateOccurrence(current, currentOccurrence.clientId, (occurrence) =>
								changeOccurrenceDisplay(occurrence, display),
							),
						)
					}
				/>
			) : null}
			{kind === "notes" && currentOccurrence !== undefined ? (
				<ExerciseNotesSheet
					key="notes"
					onClose={onClose}
					exercise={currentExercise}
					occurrence={currentOccurrence}
					disabled={props.disabled || props.existingGuard}
					onNotes={(notes) =>
						actions.change((current) =>
							updateOccurrence(current, currentOccurrence.clientId, (occurrence) => ({
								...occurrence,
								notes,
							})),
						)
					}
				/>
			) : null}
			{kind === "history" && currentOccurrence !== undefined && pro ? (
				<HistoryOverlay
					key="history"
					onClose={onClose}
					exerciseName={exerciseName}
					beforeStartedAt={draft?.startedAt}
					exerciseId={currentOccurrence.exerciseId}
					imperial={context.settings.unitSystem === "imperial"}
					onAppend={(rows) => actions.appendHistory(currentOccurrence, rows)}
					excludeWorkoutId={draft?.mode.kind === "historical" ? draft.mode.entityId : undefined}
				/>
			) : null}
			{kind === "history" && currentOccurrence !== undefined && !pro ? (
				<HistoryRequiresPro key="history-pro" onClose={onClose} exerciseName={exerciseName} />
			) : null}
			{kind === "reload" ? (
				<ConfirmDialog
					key="reload"
					onClose={onClose}
					cancelLabel="Keep draft"
					title="Reload the saved version?"
					confirmLabel="Discard changes and reload"
					onConfirm={() => actions.reloadSaved(props.onReloaded)}
					description="Your unsaved changes will be discarded. The newer saved record will not be overwritten."
				/>
			) : null}
			{kind === "finish" && draft !== undefined ? (
				<FinishReview
					key="finish"
					draft={draft}
					now={props.now}
					onClose={onClose}
					names={props.names}
					onSave={props.onSave}
					saving={isWorkoutEditorSaving(snapshot)}
				/>
			) : null}
			{kind === "discard" ? (
				<ConfirmDialog
					key="discard"
					onClose={onClose}
					cancelLabel="Keep logging"
					onConfirm={props.onDiscarded}
					title={live ? "Discard workout?" : "Discard changes?"}
					confirmLabel={live ? "Discard workout" : "Discard changes"}
					description="Everything in this draft is lost. Saved workouts and measurements stay as they are."
				/>
			) : null}
			{kind === "delete-exercise" && currentOccurrence !== undefined ? (
				<ConfirmDialog
					onClose={onClose}
					key="delete-exercise"
					disabled={props.locked}
					cancelLabel="Keep exercise"
					confirmLabel="Delete exercise"
					title="Delete exercise with completed sets?"
					description="This removes the exercise and all its sets from this draft. This cannot be undone."
					onConfirm={() => {
						if (!props.locked) {
							actions.change((current) =>
								removeWorkoutItems(current, [currentOccurrence.clientId], []),
							);
							onClose();
						}
					}}
				/>
			) : null}
		</MotionPresence>
	);
}
