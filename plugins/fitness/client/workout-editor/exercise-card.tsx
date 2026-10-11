import { Schema } from "@ryot-app/plugin-client-sdk/effect";
import { Button, TextArea } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";

import type {
	WorkoutEditorDraft,
	WorkoutEditorOccurrence,
	WorkoutEditorSet,
} from "../../shared/workout-editor-draft";
import {
	resolveWorkoutRestTime,
	type WorkoutPreferenceSettings,
} from "../../shared/workout-editor-preferences";
import {
	requiredWorkoutMeasurementsByKind,
	WorkoutSetLotSchema,
	workoutSetLots,
} from "../../shared/workout-set";
import { changeOccurrenceDisplay, newWorkoutSet, updateOccurrence, updateSet } from "./actions";
import { EditorField, EditorSelect } from "./controls";
import { ExerciseInstructions } from "./instructions";
import type { EditorExercise } from "./queries";

const label = (name: string) => name.replaceAll("_", " ");
const measurementSuffix = (field: string, occurrence: WorkoutEditorOccurrence) => {
	if (field === "weight") {
		return ` (${occurrence.display?.weightUnit ?? "kg"})`;
	}
	if (field === "distance") {
		return ` (${occurrence.display?.distanceUnit ?? "km"})`;
	}
	if (field === "duration") {
		return ` (${occurrence.display?.durationUnit ?? "minutes"})`;
	}
	return "";
};

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
	readonly onPrevious: (
		set: WorkoutEditorSet,
		field: "reps" | "weight" | "duration" | "distance",
	) => void;
	readonly onHistory: () => void;
	readonly onMedia: () => void;
	readonly onReplace: () => void;
	readonly onDelete: () => void;
	readonly onOverrides: () => void;
	readonly onRpeHelp: () => void;
	readonly onCycle: () => void;
	readonly onAddedSet: () => void;
	readonly onStartRest: () => void;
	readonly onSkipRest: () => void;
}) {
	const { exercise, settings, onChange, occurrence, draft: editorDraft } = props;
	const disabled = props.disabled || exercise === undefined;
	const live = editorDraft.mode.kind === "live";
	const template =
		editorDraft.mode.kind === "template-create" || editorDraft.mode.kind === "template-edit";
	const change = (transform: (occurrence: WorkoutEditorOccurrence) => WorkoutEditorOccurrence) =>
		onChange((draft) => updateOccurrence(draft, occurrence.clientId, transform));
	const patchSet = (id: string, transform: (set: WorkoutEditorSet) => WorkoutEditorSet) =>
		onChange((draft) => updateSet(draft, occurrence.clientId, id, transform));
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
					<ol className="flex flex-col gap-3">
						{occurrence.sets.map((set, index) => {
							const rest = resolveWorkoutRestTime({
								settings,
								lot: set.setLot,
								overrides: exercise?.overrides ?? {},
								explicitSeconds:
									set.restChoice.kind === "explicit" ? set.restChoice.seconds : undefined,
							});
							const executing = editorDraft.executionCountdown?.setId === set.clientId;
							let confirmationLabel = "Confirm";
							if (set.included) {
								confirmationLabel = "Unconfirm";
							} else if (executing) {
								confirmationLabel = "Confirm now";
							}
							return (
								<li
									tabIndex={-1}
									key={set.clientId}
									id={`set-${set.clientId}`}
									aria-label={`Set ${index + 1}`}
									className="flex scroll-mt-6 flex-col gap-2 rounded-lg border border-border p-3"
								>
									<div className="flex flex-wrap items-end gap-2">
										<span className="self-center font-semibold">{index + 1}</span>
										<EditorSelect
											value={set.setLot}
											disabled={disabled}
											label={`Set ${index + 1} type`}
											choices={workoutSetLots.map((value) => ({ value, label: label(value) }))}
											onChange={(value) => {
												const parsed = Schema.decodeUnknownResult(WorkoutSetLotSchema)(value);
												if (parsed._tag === "Success") {
													patchSet(set.clientId, (item) => ({ ...item, setLot: parsed.success }));
												}
											}}
										/>
										{requiredWorkoutMeasurementsByKind[set.exerciseKind].map((field) => (
											<div key={field} className="min-w-24 flex-1">
												<EditorField
													numeric
													value={set[field]}
													disabled={disabled}
													label={`Set ${index + 1} ${field}${measurementSuffix(field, occurrence)}`}
													onChange={(value) =>
														patchSet(set.clientId, (item) => ({ ...item, [field]: value }))
													}
												/>
												<Button
													variant="ghost"
													disabled={disabled}
													onClick={() => props.onPrevious(set, field)}
												>
													Previous {field}
												</Button>
											</div>
										))}
										{live &&
										!set.included &&
										!executing &&
										props.countdownEnabled &&
										Number(set.duration) > 0 ? (
											<Button disabled={disabled} onClick={() => props.onStartExecution(set)}>
												Start countdown
											</Button>
										) : null}
										{live ? (
											<Button
												disabled={disabled}
												onClick={() => props.onConfirm(set)}
												variant={
													set.included || (props.countdownEnabled && Number(set.duration) > 0)
														? "secondary"
														: "primary"
												}
											>
												{confirmationLabel}
											</Button>
										) : null}
										{!live && !template ? (
											<label className="flex items-center gap-2">
												<input
													type="checkbox"
													disabled={disabled}
													checked={set.included}
													onChange={(event) =>
														patchSet(set.clientId, (item) => ({
															...item,
															included: event.target.checked,
														}))
													}
												/>
												Include set
											</label>
										) : null}
										<Button
											variant="ghost"
											disabled={disabled}
											aria-label={`Delete set ${index + 1}`}
											onClick={() =>
												change((item) => ({
													...item,
													sets: item.sets.filter(({ clientId }) => clientId !== set.clientId),
												}))
											}
										>
											<AppIcon size={16} name="trash-2" />
										</Button>
									</div>
									<details>
										<summary className="cursor-pointer text-sm text-text-subtle">
											Rest: {rest.kind === "resolved" ? `${rest.seconds}s` : "invalid"} · Notes and
											RPE
										</summary>
										<div className="mt-2 flex flex-wrap items-end gap-3">
											<EditorField
												numeric
												disabled={disabled}
												label={`Set ${index + 1} rest seconds`}
												value={set.restChoice.kind === "explicit" ? set.restChoice.seconds : ""}
												onChange={(value) =>
													patchSet(set.clientId, (item) => ({
														...item,
														restChoice:
															value === ""
																? { kind: "inherited" }
																: { seconds: value, kind: "explicit" },
													}))
												}
											/>
											<EditorField
												numeric
												value={set.rpe}
												disabled={disabled}
												label={`Set ${index + 1} RPE`}
												onChange={(rpe) => patchSet(set.clientId, (item) => ({ ...item, rpe }))}
											/>
											<Button variant="ghost" onClick={props.onRpeHelp}>
												RPE help
											</Button>
											<EditorField
												value={set.note}
												disabled={disabled || !props.pro}
												label={`Set ${index + 1} note${props.pro ? "" : " (Pro)"}`}
												onChange={(note) => patchSet(set.clientId, (item) => ({ ...item, note }))}
											/>
											{!props.pro && set.note ? (
												<Button
													variant="ghost"
													disabled={disabled}
													onClick={() =>
														patchSet(set.clientId, (item) => ({ ...item, note: undefined }))
													}
												>
													Remove existing note
												</Button>
											) : null}
										</div>
									</details>
									{editorDraft.pendingRest?.setId === set.clientId ? (
										<div
											role="status"
											className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 p-3"
										>
											<span className="mr-auto text-sm">
												Ready for {editorDraft.pendingRest.seconds}s rest?
											</span>
											<Button disabled={disabled} onClick={props.onStartRest}>
												Start rest
											</Button>
											<Button variant="secondary" disabled={disabled} onClick={props.onSkipRest}>
												Skip rest
											</Button>
										</div>
									) : null}
								</li>
							);
						})}
					</ol>
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
		</section>
	);
}
