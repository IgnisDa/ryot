import type { Text } from "@ryot-app/plugin-client-sdk/react";
import { useFormatters } from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	Dialog,
	Field,
	formatClock,
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
import { useFitnessMessages } from "../messages";
import { changeWorkoutEnergyUnit } from "./actions";
import { type DraftChange, isTemplateDraft } from "./draft-ops";
import { EditorSheet } from "./editor-sheet";
import { activeDurationSeconds } from "./timers";

export function ConfirmDialog(props: {
	readonly title: Text;
	readonly open?: boolean;
	readonly description: Text;
	readonly cancelLabel: Text;
	readonly disabled?: boolean;
	readonly onClose: () => void;
	readonly confirmLabel: string;
	readonly onConfirm: () => void;
}) {
	return (
		<Dialog
			size="sm"
			kind="alert"
			closeIcon={null}
			title={props.title}
			onClose={props.onClose}
			open={props.open ?? true}
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

export function WorkoutPreferencesSheet(props: {
	readonly pro: boolean;
	readonly disabled: boolean;
	readonly onClose: () => void;
	readonly onChange: DraftChange;
	readonly preferences: ReturnType<typeof resolveWorkoutLocalPreferences>;
}) {
	const text = useFitnessMessages();
	const set = (key: keyof WorkoutEditorLocalPreferences, value: boolean) =>
		props.onChange((draft) => ({
			...draft,
			localPreferences: { ...draft.localPreferences, [key]: value },
		}));
	const row = (
		key: keyof WorkoutEditorLocalPreferences,
		title: ReactNode,
		label: Text,
		description: Text,
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
		<EditorSheet
			onClose={props.onClose}
			title={text("client.editor.preferences")}
			description={text("client.wsheets.apply-only")}
			closeLabel={text("client.wsheets.close-preferences")}
			footer={
				<>
					<Button
						variant="ghost"
						disabled={props.disabled}
						onClick={() => props.onChange((draft) => ({ ...draft, localPreferences: undefined }))}
					>
						{text("client.wsheets.reset")}
					</Button>
					<Button onClick={props.onClose}>{text("common.action.done")}</Button>
				</>
			}
		>
			<RowGroup>
				{row(
					"muteSounds",
					text("property.mute-sounds"),
					text("property.mute-sounds"),
					text("client.wsheets.mute-description"),
				)}
				{row(
					"promptForRestTimer",
					props.pro ? (
						text("client.wsheets.ask-rest")
					) : (
						<>
							{text("client.wsheets.ask-rest")}{" "}
							<span className="rounded-sm bg-accent-soft px-1 text-[10px] font-bold text-accent-text">
								{text("client.wsheets.pro")}
							</span>
						</>
					),
					text("client.wsheets.ask-rest"),
					text("client.wsheets.ask-rest-description"),
					!props.pro && !props.preferences.promptForRestTimer,
				)}
				{row(
					"startTimerForDurationExercises",
					text("client.wsheets.duration-timer"),
					text("client.wsheets.duration-timer"),
					text("client.wsheets.duration-timer-description"),
				)}
			</RowGroup>
		</EditorSheet>
	);
}

export function WorkoutDetailsSheet(props: {
	readonly disabled: boolean;
	readonly onClose: () => void;
	readonly onChange: DraftChange;
	readonly draft: WorkoutEditorDraft;
}) {
	const text = useFitnessMessages();
	const { draft, onChange } = props;
	const template = isTemplateDraft(draft);
	return (
		<EditorSheet
			wide="side"
			onClose={props.onClose}
			closeLabel={text("client.wsheets.close-details")}
			footer={<Button onClick={props.onClose}>{text("common.action.done")}</Button>}
			title={
				template ? text("client.wsheets.template-details") : text("client.wsheets.workout-details")
			}
		>
			<fieldset disabled={props.disabled} className="grid min-w-0 gap-4 border-0 p-0">
				<Field label={text("client.measurements.add.name")}>
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
				<Field
					label={
						template ? text("client.wsheets.template-comment") : text("client.wsheets.reflection")
					}
				>
					{(control) => (
						<TextArea
							{...control}
							value={draft.comment ?? ""}
							onChange={(event) =>
								onChange((current) => ({ ...current, comment: event.target.value }))
							}
							placeholder={
								template
									? text("client.wsheets.template-placeholder")
									: text("client.wsheets.reflection-placeholder")
							}
						/>
					)}
				</Field>
				{template ? null : (
					<Field optional label={text("client.wsheets.energy", { unit: draft.displayEnergyUnit })}>
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
									value={draft.displayEnergyUnit}
									label={text("property.energy-unit")}
									optionClassName="w-12 pointer-coarse:w-14"
									onChange={(unit) => onChange((current) => changeWorkoutEnergyUnit(current, unit))}
									options={[
										{
											value: "kcal",
											label: text("client.wsheets.energy-unit-kcal"),
											content: text("client.wsheets.energy-unit-kcal"),
										},
										{
											value: "kJ",
											label: text("client.wsheets.energy-unit-kj"),
											content: text("client.wsheets.energy-unit-kj"),
										},
									]}
								/>
							</div>
						)}
					</Field>
				)}
			</fieldset>
		</EditorSheet>
	);
}

export function FinishReview(props: {
	readonly now: number;
	readonly open: boolean;
	readonly saving: boolean;
	readonly onSave: () => void;
	readonly onClose: () => void;
	readonly onClosed: () => void;
	readonly draft: WorkoutEditorDraft;
	readonly names: ReadonlyMap<string, string>;
}) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
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
	let title = text("client.wsheets.finish-title");
	if (template) {
		title = text("client.wsheets.save-template-title");
	} else if (historical) {
		title = text("client.wsheets.save-changes-title");
	}
	const active = activeDurationSeconds(draft, props.now);
	return (
		<EditorSheet
			title={title}
			open={props.open}
			onClose={props.onClose}
			onClosed={props.onClosed}
			dismissible={!props.saving}
			closeLabel={text("client.wsheets.close-review")}
			footer={
				<>
					<Button variant="secondary" disabled={props.saving} onClick={props.onClose}>
						{text("client.overlays.keep-logging")}
					</Button>
					<Button loading={props.saving} onClick={props.onSave}>
						{template ? text("client.editor.save-template") : text("client.wsheets.save-workout")}
					</Button>
				</>
			}
		>
			<div className="grid gap-4">
				{template ? (
					<p className="text-text-muted">
						{text("client.wsheets.template-summary", {
							sets: sets.length,
							exercises: draft.occurrences.length,
						})}
					</p>
				) : (
					<dl className="grid grid-cols-3 gap-3">
						<div className="grid gap-px">
							<dt className="order-2 text-xs text-text-muted">
								{historical ? text("client.wsheets.included") : text("client.wsheets.saved")}
							</dt>
							<dd className="text-lg font-semibold tabular-nums">{included}</dd>
						</div>
						<div className="grid gap-px">
							<dt className="order-2 text-xs text-text-muted">
								{historical
									? text("client.wsheets.excluded")
									: text("client.wsheets.not-completed")}
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
							<dt className="order-2 text-xs text-text-muted">
								{text("client.wsheets.active-time")}
							</dt>
							<dd className="text-lg font-semibold tabular-nums">
								{active === undefined ? text("client.editor.stat.unknown") : formatClock(active)}
							</dd>
						</div>
					</dl>
				)}
				{!template && omitted > 0 ? (
					<Notice
						tone="warning"
						icon={<AppIcon size={16} name="circle-alert" />}
						title={text("client.wsheets.omitted", {
							count: omitted,
							kind: historical ? "excluded" : "unfinished",
						})}
					>
						{historical
							? text("client.wsheets.omitted-historical")
							: text("client.wsheets.omitted-live")}
					</Notice>
				) : null}
				{!template && unsavedAttachments.length > 0 ? (
					<Notice
						tone="warning"
						icon={<AppIcon size={16} name="image" />}
						title={text("client.wsheets.attachments-title")}
					>
						{text("client.wsheets.attachments-body", {
							names: formatters
								.list({ type: "unit", style: "long" })
								.format(
									unsavedAttachments.map(
										({ exerciseId }) =>
											props.names.get(exerciseId) ?? text("client.overlays.exercise-unavailable"),
									),
								),
						})}
					</Notice>
				) : null}
				{draft.occurrences.length === 0 ? null : (
					<RowGroup>
						{draft.occurrences.map((occurrence) => (
							<div key={occurrence.clientId} className="flex items-center gap-3 px-3.5 py-2.5">
								<span className="min-w-0 flex-1 text-sm font-semibold [overflow-wrap:anywhere]">
									{props.names.get(occurrence.exerciseId) ??
										text("client.overlays.exercise-unavailable")}
								</span>
								<span className="text-sm text-text-muted tabular-nums">
									{template
										? text("client.card.sets", { count: occurrence.sets.length })
										: text("client.wsheets.fraction", {
												total: occurrence.sets.length,
												done: occurrence.sets.filter(({ included: kept }) => kept).length,
											})}
								</span>
							</div>
						))}
					</RowGroup>
				)}
			</div>
		</EditorSheet>
	);
}
