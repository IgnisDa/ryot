import type { Text } from "@ryot-app/plugin-client-sdk/react";
import { Button, Dialog } from "@ryot-app/plugin-ui-sdk";

import type { WorkoutEditorDraft } from "../../shared/workout-editor-draft";
import { MeasurementDialogs, type useMeasurementLogger } from "../measurements/measurement-logger";
import { useFitnessMessages } from "../messages";
import { changeOccurrenceDisplay, removeWorkoutItems } from "./actions";
import {
	isWorkoutEditorSaving,
	type WorkoutEditorContext,
	type WorkoutEditorControllerSnapshot,
} from "./controller-types";
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

export type EditorOverlay =
	OverlayKind | { readonly kind: OverlayKind; readonly occurrenceId: string };

type OverlayKind =
	| "finish"
	| "picker"
	| "reload"
	| "details"
	| "discard"
	| "reorder"
	| "supersets"
	| "bulk-delete"
	| "preferences"
	| "delete-exercise"
	| Exclude<ExerciseSheet, "attachments">;

export function EditorOverlays(props: {
	readonly now: number;
	readonly locked: boolean;
	readonly mediaLabel: Text;
	readonly disabled: boolean;
	readonly onSave: () => void;
	readonly onClose: () => void;
	readonly existingGuard: boolean;
	readonly onReloaded: () => void;
	readonly requestBlocked: boolean;
	readonly requestHandled: boolean;
	readonly onDiscarded: () => void;
	readonly onCloseMedia: () => void;
	readonly onFinishRequest: () => void;
	readonly refetchExercises: () => void;
	readonly scrollTo: (id: string) => void;
	readonly names: ReadonlyMap<string, string>;
	readonly overlay: undefined | EditorOverlay;
	readonly draft: undefined | WorkoutEditorDraft;
	readonly snapshot: WorkoutEditorControllerSnapshot;
	readonly context: undefined | WorkoutEditorContext;
	readonly mediaTarget: undefined | WorkoutMediaTarget;
	readonly actions: ReturnType<typeof useEditorActions>;
	readonly exercises: undefined | readonly EditorExercise[];
	readonly measurement: ReturnType<typeof useMeasurementLogger>;
	readonly controller: ReturnType<typeof useWorkoutEditor>["controller"];
}) {
	const text = useFitnessMessages();
	const { draft, actions, context, onClose, overlay, snapshot, exercises, controller } = props;
	const kind = typeof overlay === "string" ? overlay : overlay?.kind;
	const occurrenceId = typeof overlay === "object" ? overlay.occurrenceId : undefined;
	const currentOccurrence = draft?.occurrences.find(({ clientId }) => clientId === occurrenceId);
	const currentExercise = exercises?.find(({ id }) => id === currentOccurrence?.exerciseId);
	const exerciseName = currentExercise?.name ?? text("client.overlays.exercise-unavailable");
	const pro = context?.pro === true;
	const { mediaTarget } = props;
	const live = draft === undefined || draft.mode.kind === "live";
	const replacing = kind === "replace" ? currentOccurrence : undefined;
	return (
		<>
			<MeasurementDialogs
				key="measurements"
				onClose={props.measurement.close}
				dialog={props.measurement.dialog}
				trigger={props.measurement.trigger}
			/>
			<Dialog
				size="sm"
				closeIcon={null}
				key="requires-pro"
				onClose={props.onFinishRequest}
				title={text("client.overlays.pro-title")}
				closeLabel={text("client.overlays.return")}
				open={props.requestBlocked && !props.requestHandled}
				description={text("client.overlays.pro-description")}
				footer={
					<Button onClick={props.onFinishRequest}>
						{draft === undefined
							? text("client.overlays.return")
							: text("client.overlays.resume-draft")}
					</Button>
				}
			/>
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
					title={text("client.overlays.existing-title")}
					closeLabel={text("client.overlays.existing-close")}
					description={text("client.overlays.existing-description", {
						name: draft.name,
						pending: props.disabled ? "yes" : "no",
						total: draft.occurrences.flatMap(({ sets }) => sets).length,
						done: draft.occurrences.flatMap(({ sets }) => sets).filter(({ included }) => included)
							.length,
					})}
					footer={
						<>
							<Button
								variant="dangerGhost"
								disabled={props.disabled}
								onClick={() => actions.run(controller.discard())}
							>
								{text("client.overlays.discard-start")}
							</Button>
							<Button onClick={props.onFinishRequest}>
								{text("client.home.draft-live-resume")}
							</Button>
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
									name: currentExercise?.name ?? text("client.overlays.exercise-fallback"),
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
			<ConfirmDialog
				onClose={onClose}
				open={kind === "reload"}
				title={text("client.overlays.reload-title")}
				cancelLabel={text("client.overlays.keep-draft")}
				confirmLabel={text("client.overlays.reload-confirm")}
				onConfirm={() => actions.reloadSaved(props.onReloaded)}
				description={text("client.overlays.reload-description")}
			/>
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
			<ConfirmDialog
				onClose={onClose}
				open={kind === "discard"}
				onConfirm={props.onDiscarded}
				cancelLabel={text("client.overlays.keep-logging")}
				description={text("client.overlays.discard-description")}
				confirmLabel={
					live ? text("client.overlays.discard-workout") : text("client.overlays.discard-changes")
				}
				title={
					live
						? text("client.overlays.discard-workout-title")
						: text("client.overlays.discard-changes-title")
				}
			/>
			{kind === "delete-exercise" && currentOccurrence !== undefined ? (
				<ConfirmDialog
					onClose={onClose}
					key="delete-exercise"
					disabled={props.locked}
					cancelLabel={text("client.overlays.keep-exercise")}
					title={text("client.overlays.delete-exercise-title")}
					confirmLabel={text("client.overlays.delete-exercise")}
					description={text("client.overlays.delete-exercise-description")}
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
		</>
	);
}
