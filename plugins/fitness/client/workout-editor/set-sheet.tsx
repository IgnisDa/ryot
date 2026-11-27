import { useFormatters } from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	clockFormat,
	Field,
	formatClock,
	RadioGroup,
	SegmentedControl,
	Stepper,
	TextArea,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";
import { useState } from "react";

import type {
	WorkoutEditorDraft,
	WorkoutEditorOccurrence,
	WorkoutEditorSet,
} from "../../shared/workout-editor-draft";
import { workoutSetLots } from "../../shared/workout-set";
import { useFitnessMessages } from "../messages";
import { setLotLabel } from "../set-lots";
import { EditorSheet } from "./editor-sheet";
import { previousSummary } from "./set-grid";
import { ConfirmDialog } from "./workout-sheets";

const rpeValues = Array.from({ length: 11 }, (_, value) => value);

export function SetSheet(props: {
	readonly pro: boolean;
	readonly disabled: boolean;
	readonly onClose: () => void;
	readonly exerciseName: string;
	readonly onDelete: () => void;
	readonly set: WorkoutEditorSet;
	readonly draft: WorkoutEditorDraft;
	readonly onCopyPrevious: () => void;
	readonly inheritedRestSeconds: number;
	readonly occurrence: WorkoutEditorOccurrence;
	readonly previous: undefined | WorkoutEditorSet;
	readonly onChange: (transform: (set: WorkoutEditorSet) => WorkoutEditorSet) => void;
}) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
	const { set, onChange } = props;
	const rpeOptions = rpeValues.map((value) => ({
		value: String(value),
		label: text("client.template.rpe", { rpe: value }),
	}));
	const [rpeHelp, setRpeHelp] = useState(false);
	const [deleteConfirmationSetId, setDeleteConfirmationSetId] = useState<string>();
	const index = props.occurrence.sets.findIndex(({ clientId }) => clientId === set.clientId);
	const summary = previousSummary(formatters, text, props.previous, props.occurrence);
	const explicit = set.restChoice.kind === "explicit" ? set.restChoice.seconds : undefined;
	const explicitSeconds =
		explicit === undefined || !/^\d+$/.test(explicit.trim()) ? undefined : Number(explicit);
	const confirmDeleteDisabled =
		props.disabled || !set.included || set.clientId !== deleteConfirmationSetId;
	return (
		<EditorSheet
			onClose={props.onClose}
			description={props.exerciseName}
			closeLabel={text("client.sheet.close")}
			title={text("client.bulk.set", { index: index + 1 })}
			footer={
				<>
					<Button
						variant="dangerGhost"
						disabled={props.disabled}
						onClick={() => {
							if (props.disabled) {
								return;
							}
							if (set.included) {
								setDeleteConfirmationSetId(set.clientId);
								return;
							}
							props.onDelete();
						}}
					>
						<AppIcon size={15} name="trash-2" />
						{text("client.sheet.delete-set")}
					</Button>
					<Button onClick={props.onClose}>{text("common.action.done")}</Button>
				</>
			}
		>
			<fieldset disabled={props.disabled} className="grid min-w-0 gap-5 border-0 p-0">
				<div className="grid gap-1.5">
					<span className="text-[13px] font-medium">{text("client.sheet.set-type")}</span>
					<SegmentedControl
						fill
						value={set.setLot}
						optionClassName="px-2"
						label={text("client.sheet.set-type")}
						onChange={(setLot) => onChange((item) => ({ ...item, setLot }))}
						options={workoutSetLots.map((lot) => ({
							value: lot,
							label: setLotLabel(text, lot),
							content: setLotLabel(text, lot),
						}))}
					/>
				</div>
				{props.draft.mode.kind === "historical" ? null : (
					<Field
						label={text("client.sheet.rest-label")}
						hint={
							<>
								{explicit === undefined
									? text("client.sheet.rest-default", {
											lot: set.setLot,
											time: formatClock(props.inheritedRestSeconds),
										})
									: text("client.sheet.rest-custom")}
								{explicit === undefined ? null : (
									<>
										{" "}
										<button
											type="button"
											className="font-semibold text-accent-text"
											onClick={() =>
												onChange((item) => ({ ...item, restChoice: { kind: "inherited" } }))
											}
										>
											{text("client.sheet.use-default")}
										</button>
									</>
								)}
							</>
						}
					>
						{(control) => (
							<Stepper
								step={15}
								id={control.id}
								parse={clockFormat.parse}
								format={clockFormat.format}
								label={text("client.sheet.rest-label")}
								aria-describedby={control["aria-describedby"]}
								incrementIcon={<AppIcon size={16} name="plus" />}
								decrementIcon={<AppIcon size={16} name="minus" />}
								value={explicit === undefined ? props.inheritedRestSeconds : explicitSeconds}
								onChange={(seconds) =>
									onChange((item) => ({
										...item,
										restChoice:
											seconds === undefined
												? { kind: "inherited" }
												: { kind: "explicit", seconds: String(seconds) },
									}))
								}
							/>
						)}
					</Field>
				)}
				<div className="grid gap-1.5">
					<div className="flex items-center gap-2">
						<span className="text-[13px] font-medium">
							{text("client.template.rpe-label")}{" "}
							<span className="font-normal text-text-subtle">{text("client.sheet.optional")}</span>
						</span>
						<span className="flex-1" />
						{set.rpe === undefined || set.rpe === "" ? null : (
							<button
								type="button"
								className="text-xs font-semibold text-text-muted"
								onClick={() => onChange((item) => ({ ...item, rpe: undefined }))}
							>
								{text("client.sheet.clear-rpe")}
							</button>
						)}
						<button
							type="button"
							aria-expanded={rpeHelp}
							onClick={() => setRpeHelp(!rpeHelp)}
							className="text-xs font-semibold text-accent-text"
						>
							{text("client.sheet.what-is-rpe")}
						</button>
					</div>
					<RadioGroup
						value={set.rpe}
						options={rpeOptions}
						className="grid grid-cols-6 gap-1.5"
						label={text("client.template.rpe-label")}
						onChange={(rpe) => onChange((item) => ({ ...item, rpe }))}
						renderOption={(option, selected) => ({
							content: option.value,
							className: clsx(
								"h-9 rounded-md border font-semibold tabular-nums transition-colors duration-100 motion-reduce:transition-none pointer-coarse:h-11",
								selected
									? "border-accent bg-accent text-accent-ink"
									: "border-border-emphasis bg-surface text-text hover:bg-hover",
							),
						})}
					/>
					{rpeHelp ? (
						<p className="text-xs text-text-muted">{text("client.sheet.rpe-help")}</p>
					) : null}
				</div>
				<Field
					label={text("client.sheet.note")}
					hint={props.pro ? undefined : text("client.sheet.note-pro")}
				>
					{(control) => (
						<TextArea
							{...control}
							value={set.note ?? ""}
							disabled={props.disabled || !props.pro}
							onChange={(event) => onChange((item) => ({ ...item, note: event.target.value }))}
						/>
					)}
				</Field>
				{!props.pro && set.note ? (
					<Button
						size="sm"
						variant="ghost"
						className="justify-self-start"
						onClick={() => onChange((item) => ({ ...item, note: undefined }))}
					>
						{text("client.sheet.remove-note")}
					</Button>
				) : null}
				{summary === undefined ? null : (
					<Button variant="secondary" onClick={props.onCopyPrevious}>
						<AppIcon size={15} name="history" />
						{text("client.sheet.copy-previous", { summary })}
					</Button>
				)}
			</fieldset>
			<ConfirmDialog
				disabled={confirmDeleteDisabled}
				title={text("client.sheet.delete-title")}
				cancelLabel={text("common.action.cancel")}
				open={deleteConfirmationSetId !== undefined}
				confirmLabel={text("client.sheet.delete-set")}
				onClose={() => setDeleteConfirmationSetId(undefined)}
				description={text("client.sheet.delete-description")}
				onConfirm={() => {
					if (!confirmDeleteDisabled) {
						props.onDelete();
					}
					setDeleteConfirmationSetId(undefined);
				}}
			/>
		</EditorSheet>
	);
}
