import {
	Button,
	clockFormat,
	Dialog,
	Field,
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
import { formatEditorSeconds } from "./clocks";
import { previousSummary, setLotLabels } from "./set-grid";

const rpeOptions = Array.from({ length: 11 }, (_, value) => ({
	value: String(value),
	label: `RPE ${value}`,
}));

export function SetSheet(props: {
	readonly pro: boolean;
	readonly compact: boolean;
	readonly disabled: boolean;
	readonly exerciseName: string;
	readonly safeAreaBottom: number;
	readonly set: WorkoutEditorSet;
	readonly draft: WorkoutEditorDraft;
	readonly occurrence: WorkoutEditorOccurrence;
	readonly inheritedRestSeconds: number;
	readonly previous: WorkoutEditorSet | undefined;
	readonly onChange: (transform: (set: WorkoutEditorSet) => WorkoutEditorSet) => void;
	readonly onCopyPrevious: () => void;
	readonly onDelete: () => void;
	readonly onClose: () => void;
}) {
	const { set, onChange } = props;
	const [rpeHelp, setRpeHelp] = useState(false);
	const index = props.occurrence.sets.findIndex(({ clientId }) => clientId === set.clientId);
	const summary = previousSummary(props.previous, props.occurrence);
	const explicit = set.restChoice.kind === "explicit" ? set.restChoice.seconds : undefined;
	const explicitSeconds =
		explicit === undefined || !/^\d+$/.test(explicit.trim()) ? undefined : Number(explicit);
	return (
		<Dialog
			onClose={props.onClose}
			title={`Set ${index + 1}`}
			closeLabel="Close set options"
			description={props.exerciseName}
			safeAreaBottom={props.safeAreaBottom}
			closeIcon={<AppIcon name="x" size={18} />}
			placement={props.compact ? "sheet" : "center"}
			footer={
				<>
					<Button variant="dangerGhost" onClick={props.onDelete} disabled={props.disabled}>
						<AppIcon size={15} name="trash-2" />
						Delete set
					</Button>
					<Button onClick={props.onClose}>Done</Button>
				</>
			}
		>
			<fieldset disabled={props.disabled} className="grid min-w-0 gap-5 border-0 p-0">
				<div className="grid gap-1.5">
					<span className="text-[13px] font-medium">Set type</span>
					<SegmentedControl
						label="Set type"
						value={set.setLot}
						className="w-full"
						optionClassName="flex-1 px-2"
						onChange={(setLot) => onChange((item) => ({ ...item, setLot }))}
						options={workoutSetLots.map((lot) => ({
							value: lot,
							label: setLotLabels[lot],
							content: setLotLabels[lot],
						}))}
					/>
				</div>
				{props.draft.mode.kind === "historical" ? null : (
					<Field
						label="Rest after this set"
						hint={
							<>
								{explicit === undefined
									? `Using the ${setLotLabels[set.setLot].toLowerCase()} default for this exercise (${formatEditorSeconds(props.inheritedRestSeconds)}). `
									: "Custom for this set. "}
								0:00 turns rest off.
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
											Use default
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
								label="Rest after this set"
								format={clockFormat.format}
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
							RPE <span className="font-normal text-text-subtle">(optional)</span>
						</span>
						<span className="flex-1" />
						{set.rpe === undefined || set.rpe === "" ? null : (
							<button
								type="button"
								className="text-xs font-semibold text-text-muted"
								onClick={() => onChange((item) => ({ ...item, rpe: undefined }))}
							>
								Clear RPE
							</button>
						)}
						<button
							type="button"
							aria-expanded={rpeHelp}
							onClick={() => setRpeHelp(!rpeHelp)}
							className="text-xs font-semibold text-accent-text"
						>
							What is RPE?
						</button>
					</div>
					<RadioGroup
						label="RPE"
						value={set.rpe}
						options={rpeOptions}
						className="grid grid-cols-6 gap-1.5"
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
						<p className="text-xs text-text-muted">
							Rate of perceived exertion, a whole number from 0 (no effort) to 10 (no more
							repetitions possible). 9 means about one repetition remained; 8 means about two.
						</p>
					) : null}
				</div>
				<Field label="Set note" hint={props.pro ? undefined : "Set notes require Pro."}>
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
						Remove existing note
					</Button>
				) : null}
				{summary === undefined ? null : (
					<Button variant="secondary" onClick={props.onCopyPrevious}>
						<AppIcon size={15} name="history" />
						Copy previous ({summary})
					</Button>
				)}
			</fieldset>
		</Dialog>
	);
}
