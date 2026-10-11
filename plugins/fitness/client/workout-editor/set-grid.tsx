import { CellInput } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";

import type {
	WorkoutEditorDraft,
	WorkoutEditorOccurrence,
	WorkoutEditorSet,
} from "../../shared/workout-editor-draft";
import { requiredWorkoutMeasurementsByKind, type WorkoutSetLot } from "../../shared/workout-set";
import { CompletionToggle } from "./completion-toggle";
import { formatEditorSeconds } from "./session-timers";

type SetMeasurement =
	(typeof requiredWorkoutMeasurementsByKind)[keyof typeof requiredWorkoutMeasurementsByKind][number];

export type InvalidSet = { readonly setId: string; readonly fields: readonly SetMeasurement[] };

export const setLotLabels: Record<WorkoutSetLot, string> = {
	drop: "Drop",
	normal: "Normal",
	warm_up: "Warm-up",
	failure: "Failure",
};

export const setLotTags: Partial<
	Record<WorkoutSetLot, { readonly tag: string; readonly tone: string }>
> = {
	drop: { tag: "D", tone: "text-info" },
	failure: { tag: "F", tone: "text-danger" },
	warm_up: { tag: "W", tone: "text-warning" },
};

const measurementUnit = (field: SetMeasurement, occurrence: WorkoutEditorOccurrence) => {
	if (field === "weight") {
		return occurrence.display?.weightUnit ?? "kg";
	}
	if (field === "distance") {
		return occurrence.display?.distanceUnit ?? "km";
	}
	if (field === "duration") {
		return occurrence.display?.durationUnit ?? "minutes";
	}
	return undefined;
};

const columnLabel = (field: SetMeasurement, occurrence: WorkoutEditorOccurrence) => {
	const unit = measurementUnit(field, occurrence);
	if (field === "duration") {
		return unit === "seconds" ? "Sec" : "Min";
	}
	return unit ?? "Reps";
};

const unitAbbreviations: Partial<Record<string, string>> = { seconds: "s", minutes: "min" };

const has = (value: string | undefined) => value !== undefined && value.trim() !== "";

export const missingMeasurements = (set: WorkoutEditorSet) =>
	requiredWorkoutMeasurementsByKind[set.exerciseKind].filter((field) => {
		const value = set[field];
		return !has(value) || !Number.isFinite(Number(value)) || Number(value) < 0;
	});

export const previousSummary = (
	previous: WorkoutEditorSet | undefined,
	occurrence: WorkoutEditorOccurrence,
) => {
	if (previous === undefined) {
		return undefined;
	}
	if (occurrence.exerciseKind === "reps_and_weight" && has(previous.weight) && has(previous.reps)) {
		return `${previous.weight} ${measurementUnit("weight", occurrence)} × ${previous.reps}`;
	}
	const parts = requiredWorkoutMeasurementsByKind[occurrence.exerciseKind].flatMap((field) => {
		const value = previous[field];
		if (!has(value)) {
			return [];
		}
		const unit = measurementUnit(field, occurrence);
		if (unit === undefined) {
			return [`${value} reps`];
		}
		return [`${value} ${unitAbbreviations[unit] ?? unit}`];
	});
	return parts.length === 0 ? undefined : parts.join(" · ");
};

const listFields = (fields: readonly string[]) =>
	fields.length < 2 ? fields.join("") : `${fields.slice(0, -1).join(", ")} and ${fields.at(-1)}`;

export function SetGrid(props: {
	readonly now: number;
	readonly compact: boolean;
	readonly disabled: boolean;
	readonly draft: WorkoutEditorDraft;
	readonly countdownEnabled: boolean;
	readonly invalid: InvalidSet | undefined;
	readonly currentSetId: string | undefined;
	readonly occurrence: WorkoutEditorOccurrence;
	readonly previous: ReadonlyMap<string, WorkoutEditorSet>;
	readonly restSeconds: (set: WorkoutEditorSet) => number | undefined;
	readonly onChange: (
		setId: string,
		transform: (set: WorkoutEditorSet) => WorkoutEditorSet,
	) => void;
	readonly onStart: (set: WorkoutEditorSet) => void;
	readonly onComplete: (set: WorkoutEditorSet) => void;
	readonly onCopyPrevious: (set: WorkoutEditorSet) => void;
	readonly onOpenSet: (set: WorkoutEditorSet) => void;
}) {
	const { draft, compact, occurrence } = props;
	const live = draft.mode.kind === "live";
	const historical = draft.mode.kind === "historical";
	const fields = requiredWorkoutMeasurementsByKind[occurrence.exerciseKind];
	const showPrevious = !(compact && fields.length > 2);
	let completion: string | undefined;
	if (live) {
		completion = compact ? "2.75rem" : "2.25rem";
	} else if (historical) {
		completion = compact ? "3rem" : "2.5rem";
	}
	const columns = [
		"2.125rem",
		compact ? "minmax(0,1fr)" : "minmax(5rem,1fr)",
		...fields.map(() => (compact ? "minmax(3.25rem,4rem)" : "5.25rem")),
		compact ? undefined : "2.75rem",
		completion,
	]
		.filter((column) => column !== undefined)
		.join(" ");
	const ordinals = occurrence.sets.map(
		(_, index) =>
			occurrence.sets.slice(0, index + 1).filter(({ setLot }) => setLot !== "warm_up").length,
	);
	return (
		<div className="grid gap-0.5">
			<div
				aria-hidden="true"
				style={{ gridTemplateColumns: columns }}
				className="grid items-center gap-1.5 px-1 text-[11px] font-semibold tracking-wider text-text-subtle uppercase"
			>
				<span>Set</span>
				<span>{showPrevious ? "Previous" : ""}</span>
				{fields.map((field) => (
					<span key={field} className="text-center">
						{columnLabel(field, occurrence)}
					</span>
				))}
				{compact ? null : <span className="text-center">RPE</span>}
				{live ? (
					<span className="flex justify-end pr-2.5">
						<AppIcon size={13} name="check" />
					</span>
				) : null}
				{historical ? <span className="text-center">Incl.</span> : null}
			</div>
			{occurrence.sets.map((set, index) => {
				const number = index + 1;
				const lot = setLotTags[set.setLot];
				const previous = props.previous.get(set.clientId);
				const summary = previousSummary(previous, occurrence);
				const invalid = props.invalid?.setId === set.clientId ? props.invalid : undefined;
				const execution =
					draft.executionCountdown?.setId === set.clientId ? draft.executionCountdown : undefined;
				const rest = draft.restCountdown?.setId === set.clientId ? draft.restCountdown : undefined;
				const restSeconds = props.restSeconds(set);
				const remaining = (countdown: NonNullable<WorkoutEditorDraft["restCountdown"]>) =>
					countdown.pausedRemainingSeconds ?? (Date.parse(countdown.deadline) - props.now) / 1000;
				const starts =
					live &&
					props.countdownEnabled &&
					fields.includes("duration") &&
					!set.included &&
					execution === undefined;
				let restText = "Rest off";
				if (rest !== undefined) {
					restText = `Resting ${formatEditorSeconds(remaining(rest))} / ${formatEditorSeconds(rest.durationSeconds)}`;
				} else if (restSeconds === undefined) {
					restText = "Invalid rest";
				} else if (restSeconds > 0) {
					restText = formatEditorSeconds(restSeconds);
				}
				return (
					<div
						role="group"
						tabIndex={-1}
						key={set.clientId}
						id={`set-${set.clientId}`}
						aria-label={`Set ${number}`}
						className="scroll-mt-6 outline-none"
					>
						<div
							style={{ gridTemplateColumns: columns }}
							className={clsx(
								"grid items-center gap-1.5 rounded-md px-1 py-0.5",
								!draft.mode.kind.startsWith("template") && set.included && "bg-success-soft",
								live &&
									props.currentSetId === set.clientId &&
									"ring-1 ring-border-emphasis ring-inset",
							)}
						>
							<button
								type="button"
								onClick={() => props.onOpenSet(set)}
								aria-label={`Set ${number}, ${setLotLabels[set.setLot]}. Set options`}
								className={clsx(
									"h-8 min-w-8 rounded-sm px-1.5 text-left text-[13px] font-semibold tabular-nums hover:bg-hover pointer-coarse:h-10",
									lot?.tone ?? "text-text",
								)}
							>
								{lot?.tag ?? ordinals[index]}
							</button>
							{showPrevious ? (
								<button
									type="button"
									onClick={() => props.onCopyPrevious(set)}
									disabled={props.disabled || summary === undefined}
									aria-label={`Set ${number}: copy previous ${summary ?? "values"}`}
									className="min-w-0 truncate rounded-sm px-0.5 py-1.5 text-left text-[13px] text-text-subtle tabular-nums enabled:hover:text-text enabled:hover:underline disabled:cursor-default"
								>
									{summary ?? "—"}
									{!compact && previous?.rpe !== undefined ? (
										<span className="ml-1.5 font-semibold text-text-muted">@{previous.rpe}</span>
									) : null}
								</button>
							) : (
								<span />
							)}
							{fields.map((field) => {
								const unit = measurementUnit(field, occurrence);
								return (
									<CellInput
										key={field}
										inputMode="decimal"
										value={set[field] ?? ""}
										disabled={props.disabled}
										placeholder={previous?.[field] ?? ""}
										invalid={invalid?.fields.includes(field)}
										aria-label={`Set ${number} ${field}${unit === undefined ? "" : ` (${unit})`}`}
										onChange={(event) =>
											props.onChange(set.clientId, (item) => ({
												...item,
												[field]: event.target.value,
											}))
										}
									/>
								);
							})}
							{compact ? null : (
								<button
									type="button"
									aria-label={`Set ${number} RPE`}
									onClick={() => props.onOpenSet(set)}
									className={clsx(
										"h-8 rounded-sm text-xs font-semibold tabular-nums hover:bg-hover",
										set.rpe === undefined || set.rpe === "" ? "text-text-subtle" : "text-text",
									)}
								>
									{set.rpe === undefined || set.rpe === "" ? "RPE" : `@${set.rpe}`}
								</button>
							)}
							{live && starts ? (
								<CompletionToggle
									pressed={false}
									variant="start"
									disabled={props.disabled}
									onClick={() => props.onStart(set)}
									label={`Start set ${number} timer`}
									icon={<AppIcon size={15} name="play" />}
								/>
							) : null}
							{live && !starts ? (
								<CompletionToggle
									variant="complete"
									pressed={set.included}
									disabled={props.disabled}
									onClick={() => props.onComplete(set)}
									icon={<AppIcon size={17} name="check" />}
									label={
										execution === undefined ? `Complete set ${number}` : `Finish set ${number} now`
									}
								/>
							) : null}
							{historical ? (
								<CompletionToggle
									variant="include"
									pressed={set.included}
									disabled={props.disabled}
									label={`Include set ${number}`}
									icon={<AppIcon size={15} name="check" />}
									onClick={() =>
										props.onChange(set.clientId, (item) => ({ ...item, included: !item.included }))
									}
								/>
							) : null}
						</div>
						{invalid === undefined ? null : (
							<p role="alert" className="pt-0.5 pr-1.5 pb-1 pl-10 text-xs font-medium text-danger">
								{invalid.fields.length === 0
									? "Enter valid values to complete this set. Zero is allowed."
									: `Enter ${listFields(invalid.fields)} to complete this set. Zero is allowed.`}
							</p>
						)}
						{invalid === undefined && set.note !== undefined && set.note !== "" ? (
							<p className="flex items-start gap-1.5 pt-0.5 pr-1.5 pb-1 pl-10 text-xs text-text-muted">
								<AppIcon size={12} name="sticky-note" className="mt-0.5 shrink-0" />
								<span className="min-w-0 [overflow-wrap:anywhere]">{set.note}</span>
							</p>
						) : null}
						{execution === undefined ? null : (
							<p className="flex items-center gap-1.5 pt-0.5 pb-1 pl-10 text-xs font-semibold text-info">
								<AppIcon size={12} name="timer" />
								{execution.pausedRemainingSeconds === undefined ? "Running" : "Paused"} ·{" "}
								{formatEditorSeconds(remaining(execution))} left
							</p>
						)}
						{index < occurrence.sets.length - 1 && !historical ? (
							<button
								type="button"
								onClick={() => props.onOpenSet(set)}
								aria-label={`Rest after set ${number}: ${restText}. Change rest`}
								className={clsx(
									"flex h-5.5 w-full items-center gap-2 pr-1.5 pl-10 text-xs font-medium tabular-nums before:h-px before:flex-1 after:h-px after:flex-1",
									rest === undefined
										? "text-text-subtle before:bg-border after:bg-border"
										: "text-accent-text before:bg-accent after:bg-border",
								)}
							>
								<AppIcon size={12} name="timer" />
								{restText}
							</button>
						) : null}
					</div>
				);
			})}
		</div>
	);
}
