import { Button, TextArea } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useState } from "react";

import type {
	WorkoutEditorDraft,
	WorkoutEditorOccurrence,
	WorkoutEditorSet,
} from "../../shared/workout-editor-draft";
import {
	resolveWorkoutRestTime,
	type WorkoutPreferenceSettings,
} from "../../shared/workout-editor-preferences";
import type { WorkoutSetLot } from "../../shared/workout-set";
import { changeOccurrenceDisplay, newWorkoutSet, updateOccurrence, updateSet } from "./actions";
import { ExerciseInstructions } from "./instructions";
import { usePreviousSets } from "./previous-sets";
import type { EditorExercise } from "./queries";
import { SetGrid, type InvalidSet } from "./set-grid";
import { SetSheet } from "./set-sheet";

const label = (name: string) => name.replaceAll("_", " ");
export function ExerciseCard(props: {
	readonly draft: WorkoutEditorDraft;
	readonly occurrence: WorkoutEditorOccurrence;
	readonly exercise: EditorExercise | undefined;
	readonly settings: WorkoutPreferenceSettings;
	readonly pro: boolean;
	readonly disabled: boolean;
	readonly onChange: (transform: (draft: WorkoutEditorDraft) => WorkoutEditorDraft) => void;
	readonly onConfirm: (set: WorkoutEditorSet) => void;
	readonly onStartExecution: (set: WorkoutEditorSet) => void;
	readonly countdownEnabled: boolean;
	readonly now: number;
	readonly compact: boolean;
	readonly safeAreaBottom: number;
	readonly invalid: InvalidSet | undefined;
	readonly currentSetId: string | undefined;
	readonly onSetChanged: (setId: string) => void;
	readonly onPrevious: (set: WorkoutEditorSet) => void;
	readonly onHistory: () => void;
	readonly onMedia: () => void;
	readonly onReplace: () => void;
	readonly onDelete: () => void;
	readonly onOverrides: () => void;
	readonly onCycle: () => void;
	readonly onAddedSet: () => void;
	readonly onStartRest: () => void;
	readonly onSkipRest: () => void;
}) {
	const { exercise, settings, onChange, occurrence, draft: editorDraft } = props;
	const disabled = props.disabled || exercise === undefined;
	const change = (transform: (occurrence: WorkoutEditorOccurrence) => WorkoutEditorOccurrence) =>
		onChange((draft) => updateOccurrence(draft, occurrence.clientId, transform));
	const patchSet = (id: string, transform: (set: WorkoutEditorSet) => WorkoutEditorSet) =>
		onChange((draft) => updateSet(draft, occurrence.clientId, id, transform));
	const previous = usePreviousSets(editorDraft, occurrence);
	const [openSetId, setOpenSetId] = useState<string>();
	const openSet = occurrence.sets.find(({ clientId }) => clientId === openSetId);
	const restFor = (lot: WorkoutSetLot, set?: WorkoutEditorSet) =>
		resolveWorkoutRestTime({
			lot,
			settings,
			overrides: exercise?.overrides ?? {},
			explicitSeconds: set?.restChoice.kind === "explicit" ? set.restChoice.seconds : undefined,
		});
	const group = editorDraft.supersets.find(({ occurrenceIds }) =>
		occurrenceIds.includes(occurrence.clientId),
	);
	return (
		<section
			tabIndex={-1}
			id={`occurrence-${occurrence.clientId}`}
			aria-label={exercise?.name ?? "Unavailable exercise"}
			className="flex scroll-mt-6 flex-col gap-3 rounded-xl border border-border bg-surface p-4"
			style={
				group === undefined
					? undefined
					: { borderInlineStartWidth: 4, borderInlineStartColor: group.color }
			}
		>
			<div className="flex flex-wrap items-center gap-2">
				<Button
					variant="ghost"
					disabled={props.disabled}
					aria-expanded={!occurrence.isCollapsed}
					onClick={() => change((item) => ({ ...item, isCollapsed: !item.isCollapsed }))}
					aria-label={`${occurrence.isCollapsed ? "Expand" : "Collapse"} ${exercise?.name ?? "exercise"}`}
				>
					<AppIcon size={16} name={occurrence.isCollapsed ? "chevron-down" : "chevron-up"} />
				</Button>
				<div className="min-w-0 flex-1">
					<h2 className="text-lg font-semibold">{exercise?.name ?? "Unavailable exercise"}</h2>
					<p className="mt-0.5 text-xs text-text-subtle">
						{label(occurrence.exerciseKind)} · {occurrence.sets.length} sets
						{exercise?.equipment.length
							? ` · ${exercise.equipment.map(({ name }) => name).join(", ")}`
							: ""}
					</p>
				</div>
				{group === undefined ? null : (
					<Button variant="secondary" onClick={props.onCycle}>
						Superset · {group.color}
					</Button>
				)}
				<Button variant="ghost" onClick={props.onReplace} disabled={props.disabled || !props.pro}>
					{props.pro ? "Replace" : "Replace (Pro)"}
				</Button>
				<Button
					variant="ghost"
					onClick={props.onDelete}
					disabled={props.disabled}
					aria-label={`Delete ${exercise?.name ?? "exercise"}`}
				>
					<AppIcon size={16} name="trash-2" />
				</Button>
			</div>
			{exercise === undefined ? (
				<p role="alert">
					This exercise is unavailable. Your draft is retained; saving is blocked until this is
					resolved.
				</p>
			) : null}
			{occurrence.isCollapsed ? (
				<p className="text-sm text-text-subtle">
					{occurrence.sets.length} sets ·{" "}
					{occurrence.sets.filter(({ included }) => included).length} included
				</p>
			) : (
				<>
					<div className="flex flex-wrap gap-2 text-sm">
						<Button
							variant="ghost"
							disabled={disabled}
							onClick={() =>
								change((item) =>
									changeOccurrenceDisplay(item, {
										distanceUnit: item.display?.distanceUnit ?? "km",
										durationUnit: item.display?.durationUnit ?? "minutes",
										weightUnit: item.display?.weightUnit === "lb" ? "kg" : "lb",
									}),
								)
							}
						>
							Weight: {occurrence.display?.weightUnit ?? "kg"}
						</Button>
						<Button
							variant="ghost"
							disabled={disabled}
							onClick={() =>
								change((item) =>
									changeOccurrenceDisplay(item, {
										weightUnit: item.display?.weightUnit ?? "kg",
										durationUnit: item.display?.durationUnit ?? "minutes",
										distanceUnit: item.display?.distanceUnit === "mi" ? "km" : "mi",
									}),
								)
							}
						>
							Distance: {occurrence.display?.distanceUnit ?? "km"}
						</Button>
						<Button
							variant="ghost"
							disabled={disabled}
							onClick={() =>
								change((item) =>
									changeOccurrenceDisplay(item, {
										weightUnit: item.display?.weightUnit ?? "kg",
										distanceUnit: item.display?.distanceUnit ?? "km",
										durationUnit: item.display?.durationUnit === "seconds" ? "minutes" : "seconds",
									}),
								)
							}
						>
							Duration: {occurrence.display?.durationUnit ?? "minutes"}
						</Button>
						<Button variant="ghost" onClick={props.onHistory}>
							History {props.pro ? "" : "(Pro)"}
						</Button>
						<Button variant="ghost" disabled={disabled} onClick={props.onOverrides}>
							Exercise defaults
						</Button>
					</div>
					<details>
						<summary className="cursor-pointer text-sm">Instructions and exercise notes</summary>
						<ExerciseInstructions exercise={exercise} />
						<label className="flex flex-col gap-1 text-sm">
							Exercise notes
							<TextArea
								disabled={disabled}
								aria-label="Exercise notes"
								value={occurrence.notes.join("\n")}
								onChange={(event) =>
									change((item) => ({ ...item, notes: event.target.value.split("\n") }))
								}
							/>
						</label>
					</details>
					<Button variant="secondary" onClick={props.onMedia}>
						Exercise attachments ({occurrence.images.length + occurrence.videos.length})
					</Button>
					<SetGrid
						now={props.now}
						draft={editorDraft}
						previous={previous}
						disabled={disabled}
						compact={props.compact}
						invalid={props.invalid}
						occurrence={occurrence}
						onComplete={props.onConfirm}
						onSkipRest={props.onSkipRest}
						onStartRest={props.onStartRest}
						onStart={props.onStartExecution}
						currentSetId={props.currentSetId}
						onCopyPrevious={props.onPrevious}
						countdownEnabled={props.countdownEnabled}
						onOpenSet={(set) => setOpenSetId(set.clientId)}
						onChange={(id, transform) => {
							props.onSetChanged(id);
							patchSet(id, transform);
						}}
						restSeconds={(set) => {
							const rest = restFor(set.setLot, set);
							return rest.kind === "resolved" ? rest.seconds : undefined;
						}}
					/>
					<Button
						variant="secondary"
						disabled={disabled}
						onClick={() => {
							change((item) => ({
								...item,
								sets: [
									...item.sets,
									{
										...newWorkoutSet(crypto.randomUUID(), item.exerciseKind, item.sets.at(-1)),
										included: editorDraft.mode.kind === "historical",
									},
								],
							}));
							props.onAddedSet();
						}}
					>
						Add set
					</Button>
				</>
			)}
			{openSet === undefined ? null : (
				<SetSheet
					set={openSet}
					pro={props.pro}
					draft={editorDraft}
					disabled={disabled}
					occurrence={occurrence}
					compact={props.compact}
					safeAreaBottom={props.safeAreaBottom}
					onClose={() => setOpenSetId(undefined)}
					previous={previous.get(openSet.clientId)}
					exerciseName={exercise?.name ?? "Unavailable exercise"}
					onCopyPrevious={() => {
						props.onPrevious(openSet);
						setOpenSetId(undefined);
					}}
					onChange={(transform) => {
						props.onSetChanged(openSet.clientId);
						patchSet(openSet.clientId, transform);
					}}
					inheritedRestSeconds={(() => {
						const rest = restFor(openSet.setLot);
						return rest.kind === "resolved" ? rest.seconds : 0;
					})()}
					onDelete={() => {
						change((item) => ({
							...item,
							sets: item.sets.filter(({ clientId }) => clientId !== openSet.clientId),
						}));
						setOpenSetId(undefined);
					}}
				/>
			)}
		</section>
	);
}
