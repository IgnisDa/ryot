import type { Text } from "@ryot-app/plugin-client-sdk/react";
import { Button, Dialog } from "@ryot-app/plugin-ui-sdk";
import { type RefObject, useState } from "react";

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
import type { SavedEntityId, useEditorActions } from "./use-editor-actions";
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

type RetainedSheet = (
	| { readonly kind: "reorder"; readonly scrollTarget?: string }
	| { readonly kind: "finish"; readonly savedId?: SavedEntityId }
) & {
	readonly draft: WorkoutEditorDraft;
	readonly occurrenceId: string | undefined;
	readonly names: ReadonlyMap<string, string>;
};

export function EditorOverlays(props: {
	readonly now: number;
	readonly locked: boolean;
	readonly mediaLabel: Text;
	readonly disabled: boolean;
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
	readonly onSaved: undefined | ((id: SavedEntityId) => void);
	readonly measurement: ReturnType<typeof useMeasurementLogger>;
	readonly detailsTriggerRef: RefObject<null | HTMLButtonElement>;
	readonly controller: ReturnType<typeof useWorkoutEditor>["controller"];
}) {
	const text = useFitnessMessages();
	const { draft, actions, context, onClose, overlay, snapshot, exercises, controller } = props;
	const kind = typeof overlay === "string" ? overlay : overlay?.kind;
	const occurrenceId = typeof overlay === "object" ? overlay.occurrenceId : undefined;
	const [sheet, setSheet] = useState<RetainedSheet>();
	if (
		draft !== undefined &&
		(kind === "reorder" || kind === "finish") &&
		(sheet?.kind !== kind ||
			sheet.draft !== draft ||
			sheet.names !== props.names ||
			sheet.occurrenceId !== occurrenceId ||
			(sheet.kind === "reorder" && sheet.scrollTarget !== undefined))
	) {
		setSheet({ kind, draft, occurrenceId, names: props.names });
	}
	const closeSheet = () => {
		setSheet(undefined);
		if (sheet?.kind === "finish" && sheet.savedId !== undefined) {
			props.onSaved?.(sheet.savedId);
		} else if (
			kind === undefined &&
			sheet?.kind === "reorder" &&
			sheet.scrollTarget !== undefined
		) {
			props.scrollTo(`occurrence-${sheet.scrollTarget}`);
		}
	};
	const currentSheetDraft = draft?.draftId === sheet?.draft.draftId ? draft : undefined;
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
			{draft !== undefined ? (
				<WorkoutDetailsSheet
					key="details"
					draft={draft}
					onClose={onClose}
					disabled={props.locked}
					open={kind === "details"}
					onChange={actions.change}
					triggerRef={props.detailsTriggerRef}
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
			{sheet?.kind === "reorder" ? (
				<ReorderOverlay
					key="reorder"
					onClose={onClose}
					onClosed={closeSheet}
					onChange={actions.change}
					draft={currentSheetDraft ?? sheet.draft}
					initialOccurrenceId={sheet.occurrenceId}
					open={kind === "reorder" && draft !== undefined}
					onPickUp={() => actions.hapticFeedback("impact")}
					onDrop={() => actions.hapticFeedback("selection")}
					names={currentSheetDraft === undefined ? sheet.names : props.names}
					onMoved={(id) => {
						setSheet({ ...sheet, scrollTarget: id });
						onClose();
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
			{sheet?.kind === "finish" ? (
				<FinishReview
					key="finish"
					now={props.now}
					onClose={onClose}
					onClosed={closeSheet}
					open={kind === "finish"}
					draft={currentSheetDraft ?? sheet.draft}
					saving={isWorkoutEditorSaving(snapshot) || draft === undefined}
					names={currentSheetDraft === undefined ? sheet.names : props.names}
					onSave={() =>
						actions.save((savedId) => {
							setSheet({ ...sheet, savedId });
							onClose();
						})
					}
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
