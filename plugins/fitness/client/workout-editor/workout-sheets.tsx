import {
	Button,
	Dialog,
	Field,
	Notice,
	Row,
	RowGroup,
	SegmentedControl,
	Switch,
	TextArea,
	TextField,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { ReactNode } from "react";

import type {
	WorkoutEditorDraft,
	WorkoutEditorLocalPreferences,
} from "../../shared/workout-editor-draft";
import type { resolveWorkoutLocalPreferences } from "../../shared/workout-editor-preferences";
import { changeWorkoutEnergyUnit } from "./actions";
import { activeDurationSeconds, formatEditorSeconds } from "./session-timers";

type DraftChange = (transform: (draft: WorkoutEditorDraft) => WorkoutEditorDraft) => void;

type SheetProps = {
	readonly compact: boolean;
	readonly safeAreaBottom: number;
	readonly onClose: () => void;
};

const closeIcon = <AppIcon name="x" size={18} />;

const isTemplateDraft = (draft: WorkoutEditorDraft) =>
	draft.mode.kind === "template-create" || draft.mode.kind === "template-edit";

export function WorkoutDetailsSheet(
	props: SheetProps & {
		readonly disabled: boolean;
		readonly draft: WorkoutEditorDraft;
		readonly onChange: DraftChange;
	},
) {
	const { draft, onChange } = props;
	const template = isTemplateDraft(draft);
	return (
		<Dialog
			closeIcon={closeIcon}
			onClose={props.onClose}
			closeLabel="Close details"
			safeAreaBottom={props.safeAreaBottom}
			placement={props.compact ? "sheet" : "side"}
			footer={<Button onClick={props.onClose}>Done</Button>}
			title={template ? "Template details" : "Workout details"}
		>
			<fieldset disabled={props.disabled} className="grid min-w-0 gap-4 border-0 p-0">
				<Field label="Name">
					{(control) => (
						<TextField
							{...control}
							value={draft.name}
							onChange={(event) =>
								onChange((current) => ({ ...current, name: event.target.value }))
							}
						/>
					)}
				</Field>
				<Field label={template ? "Template comment" : "Reflection"}>
					{(control) => (
						<TextArea
							{...control}
							value={draft.comment ?? ""}
							placeholder={template ? "Who it's for, progression notes…" : "How did it go?"}
							onChange={(event) =>
								onChange((current) => ({ ...current, comment: event.target.value }))
							}
						/>
					)}
				</Field>
				{template ? null : (
					<Field optional label={`Energy burned (${draft.displayEnergyUnit})`}>
						{(control) => (
							<div className="flex items-center gap-2">
								<TextField
									{...control}
									inputMode="decimal"
									className="min-w-0 flex-1"
									value={draft.caloriesBurnt ?? ""}
									onChange={(event) =>
										onChange((current) => ({ ...current, caloriesBurnt: event.target.value }))
									}
								/>
								<SegmentedControl
									label="Energy unit"
									value={draft.displayEnergyUnit}
									optionClassName="w-12 pointer-coarse:w-14"
									onChange={(unit) => onChange((current) => changeWorkoutEnergyUnit(current, unit))}
									options={[
										{ value: "kcal", label: "kcal", content: "kcal" },
										{ value: "kJ", label: "kJ", content: "kJ" },
									]}
								/>
							</div>
						)}
					</Field>
				)}
			</fieldset>
		</Dialog>
	);
}

export function WorkoutPreferencesSheet(
	props: SheetProps & {
		readonly pro: boolean;
		readonly disabled: boolean;
		readonly onChange: DraftChange;
		readonly preferences: ReturnType<typeof resolveWorkoutLocalPreferences>;
	},
) {
	const set = (key: keyof WorkoutEditorLocalPreferences, value: boolean) =>
		props.onChange((draft) => ({
			...draft,
			localPreferences: { ...draft.localPreferences, [key]: value },
		}));
	const row = (
		key: keyof WorkoutEditorLocalPreferences,
		title: ReactNode,
		label: string,
		description: string,
		disabled = false,
	) => (
		<Row
			title={title}
			description={description}
			trailing={
				<Switch
					label={label}
					checked={props.preferences[key]}
					disabled={props.disabled || disabled}
					onChange={(value) => set(key, value)}
				/>
			}
		/>
	);
	return (
		<Dialog
			closeIcon={closeIcon}
			onClose={props.onClose}
			title="Workout preferences"
			closeLabel="Close preferences"
			safeAreaBottom={props.safeAreaBottom}
			description="Apply to this workout only."
			placement={props.compact ? "sheet" : "center"}
			footer={
				<>
					<Button
						variant="ghost"
						disabled={props.disabled}
						onClick={() => props.onChange((draft) => ({ ...draft, localPreferences: undefined }))}
					>
						Reset to default
					</Button>
					<Button onClick={props.onClose}>Done</Button>
				</>
			}
		>
			<RowGroup>
				{row("muteSounds", "Mute sounds", "Mute sounds", "Set, rest and timer sounds")}
				{row(
					"promptForRestTimer",
					props.pro ? (
						"Ask before resting"
					) : (
						<>
							Ask before resting{" "}
							<span className="rounded-sm bg-accent-soft px-1 text-[10px] font-bold text-accent-text">
								PRO
							</span>
						</>
					),
					"Ask before resting",
					"Confirm before each rest timer starts",
					!props.pro && !props.preferences.promptForRestTimer,
				)}
				{row(
					"startTimerForDurationExercises",
					"Timer for duration sets",
					"Timer for duration sets",
					"Count down the target time before completing",
				)}
			</RowGroup>
		</Dialog>
	);
}

export function FinishReview(
	props: SheetProps & {
		readonly now: number;
		readonly saving: boolean;
		readonly draft: WorkoutEditorDraft;
		readonly names: ReadonlyMap<string, string>;
		readonly onSave: () => void;
	},
) {
	const { draft } = props;
	const template = isTemplateDraft(draft);
	const historical = draft.mode.kind === "historical";
	const sets = draft.occurrences.flatMap((occurrence) => occurrence.sets);
	const included = sets.filter(({ included: kept }) => kept).length;
	const omitted = sets.length - included;
	const unsavedAttachments = draft.occurrences.filter(
		(occurrence) =>
			!occurrence.sets.some(({ included: kept }) => kept) &&
			(occurrence.images.length > 0 || occurrence.videos.length > 0),
	);
	let title = "Finish workout?";
	if (template) {
		title = "Save template?";
	} else if (historical) {
		title = "Save changes?";
	}
	const active = activeDurationSeconds(draft, props.now);
	return (
		<Dialog
			title={title}
			closeIcon={closeIcon}
			onClose={props.onClose}
			closeLabel="Close review"
			dismissible={!props.saving}
			safeAreaBottom={props.safeAreaBottom}
			placement={props.compact ? "sheet" : "center"}
			footer={
				<>
					<Button variant="secondary" disabled={props.saving} onClick={props.onClose}>
						Keep logging
					</Button>
					<Button loading={props.saving} onClick={props.onSave}>
						{template ? "Save template" : "Save workout"}
					</Button>
				</>
			}
		>
			<div className="grid gap-4">
				{template ? (
					<p className="text-text-muted">
						{draft.occurrences.length} exercises and {sets.length} planned sets. Partly filled sets
						are kept; completely empty set rows are dropped.
					</p>
				) : (
					<dl className="grid grid-cols-3 gap-3">
						<div className="grid gap-px">
							<dt className="order-2 text-xs text-text-muted">
								{historical ? "Included sets" : "Sets saved"}
							</dt>
							<dd className="text-lg font-semibold tabular-nums">{included}</dd>
						</div>
						<div className="grid gap-px">
							<dt className="order-2 text-xs text-text-muted">
								{historical ? "Excluded" : "Not completed"}
							</dt>
							<dd
								className={
									omitted > 0 ? "text-lg font-semibold text-warning" : "text-lg font-semibold"
								}
							>
								{omitted}
							</dd>
						</div>
						<div className="grid gap-px">
							<dt className="order-2 text-xs text-text-muted">Active time</dt>
							<dd className="text-lg font-semibold tabular-nums">
								{active === undefined ? "Unknown" : formatEditorSeconds(active)}
							</dd>
						</div>
					</dl>
				)}
				{!template && omitted > 0 ? (
					<Notice
						tone="warning"
						icon={<AppIcon size={16} name="circle-alert" />}
						title={`${omitted} ${historical ? "excluded" : "unfinished"} ${omitted === 1 ? "set" : "sets"} won't be saved`}
					>
						{historical
							? "Only included sets are saved."
							: "Only completed sets are saved. Go back to complete or delete them."}
					</Notice>
				) : null}
				{!template && unsavedAttachments.length > 0 ? (
					<Notice
						tone="warning"
						title="Some attachments won't be saved"
						icon={<AppIcon size={16} name="image" />}
					>
						Attachments on exercises with no included sets will not be saved:{" "}
						{unsavedAttachments
							.map(({ exerciseId }) => props.names.get(exerciseId) ?? "Unavailable exercise")
							.join(", ")}
						.
					</Notice>
				) : null}
				{draft.occurrences.length === 0 ? null : (
					<RowGroup>
						{draft.occurrences.map((occurrence) => (
							<div key={occurrence.clientId} className="flex items-center gap-3 px-3.5 py-2.5">
								<span className="min-w-0 flex-1 text-sm font-semibold [overflow-wrap:anywhere]">
									{props.names.get(occurrence.exerciseId) ?? "Unavailable exercise"}
								</span>
								<span className="text-sm text-text-muted tabular-nums">
									{template
										? `${occurrence.sets.length} sets`
										: `${occurrence.sets.filter(({ included: kept }) => kept).length}/${occurrence.sets.length}`}
								</span>
							</div>
						))}
					</RowGroup>
				)}
			</div>
		</Dialog>
	);
}

export function ConfirmDialog(props: {
	readonly title: string;
	readonly description: string;
	readonly cancelLabel: string;
	readonly confirmLabel: string;
	readonly disabled?: boolean;
	readonly onConfirm: () => void;
	readonly onClose: () => void;
}) {
	return (
		<Dialog
			size="sm"
			title={props.title}
			onClose={props.onClose}
			closeLabel={props.cancelLabel}
			description={props.description}
			footer={
				<>
					<Button variant="secondary" onClick={props.onClose}>
						{props.cancelLabel}
					</Button>
					<Button variant="danger" disabled={props.disabled} onClick={props.onConfirm}>
						{props.confirmLabel}
					</Button>
				</>
			}
		/>
	);
}
