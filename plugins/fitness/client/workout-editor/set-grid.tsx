import { type Formatters, useFormatters } from "@ryot-app/plugin-client-sdk/react";
import { CellInput, Collapse, formatClock, MotionList } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";

import type {
	WorkoutEditorDraft,
	WorkoutEditorOccurrence,
	WorkoutEditorSet,
} from "../../shared/workout-editor-draft";
import { requiredWorkoutMeasurementsByKind } from "../../shared/workout-set";
import { type FitnessText, useFitnessMessages } from "../messages";
import { setLabels, setLotLabel, setLots } from "../set-lots";
import { formatEnteredUnitValue, type MeasureUnit } from "../workout/format";
import { CompletionToggle } from "./completion-toggle";
import { occurrenceDisplay } from "./draft-ops";
import { remainingSeconds } from "./timers";

export type InvalidSet = { readonly setId: string; readonly fields: readonly SetMeasurement[] };

type SetMeasurement =
	(typeof requiredWorkoutMeasurementsByKind)[keyof typeof requiredWorkoutMeasurementsByKind][number];

const measurementUnit = (field: SetMeasurement, occurrence: WorkoutEditorOccurrence) => {
	const display = occurrenceDisplay(occurrence);
	if (field === "weight") {
		return display.weightUnit;
	}
	if (field === "distance") {
		return display.distanceUnit;
	}
	if (field === "duration") {
		return display.durationUnit;
	}
	return undefined;
};

const columnLabel = (
	text: FitnessText,
	field: SetMeasurement,
	occurrence: WorkoutEditorOccurrence,
) => {
	const unit = measurementUnit(field, occurrence);
	if (field === "duration") {
		return unit === "seconds" ? text("client.grid.sec") : text("client.grid.min");
	}
	return unit ?? text("client.grid.reps");
};

const has = (value: string | undefined) => value !== undefined && value.trim() !== "";

const enteredMeasureUnit = (unit: NonNullable<ReturnType<typeof measurementUnit>>): MeasureUnit => {
	if (unit === "seconds") {
		return "sec";
	}
	return unit === "minutes" ? "min" : unit;
};

export const previousSummary = (
	formatters: Formatters,
	text: FitnessText,
	previous: undefined | WorkoutEditorSet,
	occurrence: WorkoutEditorOccurrence,
) => {
	if (previous === undefined) {
		return undefined;
	}
	if (occurrence.exerciseKind === "reps_and_weight" && has(previous.weight) && has(previous.reps)) {
		return text("client.format.weight-reps", {
			reps: previous.reps ?? "",
			weight: formatEnteredUnitValue(
				formatters,
				previous.weight ?? "",
				enteredMeasureUnit(occurrenceDisplay(occurrence).weightUnit),
			),
		});
	}
	const parts = requiredWorkoutMeasurementsByKind[occurrence.exerciseKind].flatMap((field) => {
		const value = previous[field];
		if (!has(value)) {
			return [];
		}
		const unit = measurementUnit(field, occurrence);
		if (unit === undefined) {
			return [text("client.grid.value-reps", { value: value ?? "" })];
		}
		return [formatEnteredUnitValue(formatters, value ?? "", enteredMeasureUnit(unit))];
	});
	return parts.length === 0 ? undefined : parts.join(" · ");
};

export function SetGrid(props: {
	readonly now: number;
	readonly compact: boolean;
	readonly disabled: boolean;
	readonly draft: WorkoutEditorDraft;
	readonly countdownEnabled: boolean;
	readonly invalid: undefined | InvalidSet;
	readonly currentSetId: string | undefined;
	readonly occurrence: WorkoutEditorOccurrence;
	readonly onStart: (set: WorkoutEditorSet) => void;
	readonly onOpenSet: (set: WorkoutEditorSet) => void;
	readonly onComplete: (set: WorkoutEditorSet) => void;
	readonly previous: ReadonlyMap<string, WorkoutEditorSet>;
	readonly onCopyPrevious: (set: WorkoutEditorSet) => void;
	readonly restSeconds: (set: WorkoutEditorSet) => number | undefined;
	readonly onChange: (
		setId: string,
		transform: (set: WorkoutEditorSet) => WorkoutEditorSet,
	) => void;
}) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
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
	const labels = setLabels(occurrence.sets.map(({ setLot }) => setLot));
	return (
		<div className="grid gap-0.5">
			<div
				aria-hidden="true"
				style={{ gridTemplateColumns: columns }}
				className="grid items-center gap-1.5 px-1 text-[11px] font-semibold tracking-wider text-text-subtle uppercase"
			>
				<span>{text("client.workout.column-set")}</span>
				<span>{showPrevious ? text("client.grid.previous") : ""}</span>
				{fields.map((field) => (
					<span key={field} className="text-center">
						{columnLabel(text, field, occurrence)}
					</span>
				))}
				{compact ? null : <span className="text-center">{text("client.template.rpe-label")}</span>}
				{live ? (
					<span className="flex justify-end pr-2.5">
						<AppIcon size={13} name="check" />
					</span>
				) : null}
				{historical ? <span className="text-center">{text("client.grid.included")}</span> : null}
			</div>
			<MotionList className="grid gap-0.5">
				{occurrence.sets.map((set, index) => {
					const number = index + 1;
					const lot = setLots[set.setLot];
					const previous = props.previous.get(set.clientId);
					const summary = previousSummary(formatters, text, previous, occurrence);
					const invalid = props.invalid?.setId === set.clientId ? props.invalid : undefined;
					const execution =
						draft.executionCountdown?.setId === set.clientId ? draft.executionCountdown : undefined;
					const rest =
						draft.restCountdown?.setId === set.clientId ? draft.restCountdown : undefined;
					const restSeconds = props.restSeconds(set);
					const starts =
						live &&
						props.countdownEnabled &&
						fields.includes("duration") &&
						!set.included &&
						execution === undefined;
					let restText: string = text("client.grid.rest-off");
					if (rest !== undefined) {
						restText = text("client.grid.resting", {
							total: formatClock(rest.durationSeconds),
							remaining: formatClock(remainingSeconds(rest, props.now)),
						});
					} else if (restSeconds === undefined) {
						restText = text("client.grid.rest-invalid");
					} else if (restSeconds > 0) {
						restText = formatClock(restSeconds);
					}
					return (
						<div
							role="group"
							tabIndex={-1}
							key={set.clientId}
							id={`set-${set.clientId}`}
							className="scroll-mt-6 outline-none"
							aria-label={text("client.bulk.set", { index: number })}
						>
							<div
								style={{ gridTemplateColumns: columns }}
								className={clsx(
									"grid items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors duration-150 motion-reduce:transition-none",
									!draft.mode.kind.startsWith("template") && set.included && "bg-success-soft",
									live &&
										props.currentSetId === set.clientId &&
										"ring-1 ring-border-emphasis ring-inset",
								)}
							>
								<button
									type="button"
									onClick={() => props.onOpenSet(set)}
									aria-label={text("client.grid.set-options", {
										index: number,
										lot: setLotLabel(text, set.setLot),
									})}
									className={clsx(
										"h-8 min-w-8 rounded-sm px-1.5 text-left text-[13px] font-semibold tabular-nums hover:bg-hover pointer-coarse:h-10",
										lot.tone ?? "text-text",
									)}
								>
									{labels[index]}
								</button>
								{showPrevious ? (
									<button
										type="button"
										onClick={() => props.onCopyPrevious(set)}
										disabled={props.disabled || summary === undefined}
										className="min-w-0 truncate rounded-sm px-0.5 py-1.5 text-left text-[13px] text-text-subtle tabular-nums enabled:hover:text-text enabled:hover:underline disabled:cursor-default"
										aria-label={
											summary === undefined
												? text("client.grid.copy-previous-values", { index: number })
												: text("client.grid.copy-previous", { summary, index: number })
										}
									>
										{summary ?? "—"}
										{!compact && previous?.rpe !== undefined ? (
											<span className="ml-1.5 font-semibold text-text-muted">
												{text("client.grid.rpe-value", { rpe: previous.rpe })}
											</span>
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
											value={set[field] ?? ""}
											disabled={props.disabled}
											placeholder={previous?.[field] ?? ""}
											invalid={invalid?.fields.includes(field)}
											onFocus={(event) => event.currentTarget.select()}
											inputMode={field === "reps" ? "numeric" : "decimal"}
											onChange={(event) => {
												const value = event.currentTarget.value;
												props.onChange(set.clientId, (item) => ({ ...item, [field]: value }));
											}}
											aria-label={
												unit === undefined
													? text("client.grid.field-label", { field, index: number })
													: text("client.grid.field-label-unit", { unit, field, index: number })
											}
										/>
									);
								})}
								{compact ? null : (
									<button
										type="button"
										onClick={() => props.onOpenSet(set)}
										aria-label={text("client.grid.rpe-label", { index: number })}
										className={clsx(
											"h-8 rounded-sm text-xs font-semibold tabular-nums hover:bg-hover",
											set.rpe === undefined || set.rpe === "" ? "text-text-subtle" : "text-text",
										)}
									>
										{set.rpe === undefined || set.rpe === ""
											? text("client.template.rpe-label")
											: text("client.grid.rpe-value", { rpe: set.rpe })}
									</button>
								)}
								{live && starts ? (
									<CompletionToggle
										pressed={false}
										variant="start"
										disabled={props.disabled}
										onClick={() => props.onStart(set)}
										icon={<AppIcon size={15} name="play" />}
										label={text("client.grid.start-timer", { index: number })}
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
											execution === undefined
												? text("client.grid.complete", { index: number })
												: text("client.grid.finish", { index: number })
										}
									/>
								) : null}
								{historical ? (
									<CompletionToggle
										variant="include"
										pressed={set.included}
										disabled={props.disabled}
										icon={<AppIcon size={15} name="check" />}
										label={text("client.grid.include", { index: number })}
										onClick={() =>
											props.onChange(set.clientId, (item) => ({
												...item,
												included: !item.included,
											}))
										}
									/>
								) : null}
							</div>
							<Collapse open={invalid !== undefined}>
								{invalid === undefined ? null : (
									<p
										role="alert"
										className="pt-0.5 pr-1.5 pb-1 pl-10 text-xs font-medium text-danger"
									>
										{invalid.fields.length === 0
											? text("client.grid.invalid-generic")
											: text("client.grid.invalid", {
													fields: formatters
														.list({ style: "long", type: "conjunction" })
														.format(
															invalid.fields.map((field) => text("client.grid.field", { field })),
														),
												})}
									</p>
								)}
							</Collapse>
							<Collapse open={invalid === undefined && set.note !== undefined && set.note !== ""}>
								{invalid === undefined && set.note !== undefined && set.note !== "" ? (
									<p className="flex items-start gap-1.5 pt-0.5 pr-1.5 pb-1 pl-10 text-xs text-text-muted">
										<AppIcon size={12} name="sticky-note" className="mt-0.5 shrink-0" />
										<span className="min-w-0 [overflow-wrap:anywhere]">{set.note}</span>
									</p>
								) : null}
							</Collapse>
							<Collapse open={execution !== undefined}>
								{execution === undefined ? null : (
									<p className="flex items-center gap-1.5 pt-0.5 pb-1 pl-10 text-xs font-semibold text-info">
										<AppIcon size={12} name="timer" />
										{text("client.grid.execution", {
											time: formatClock(remainingSeconds(execution, props.now)),
											state: execution.pausedRemainingSeconds === undefined ? "running" : "paused",
										})}
									</p>
								)}
							</Collapse>
							<Collapse open={index < occurrence.sets.length - 1 && !historical}>
								<button
									type="button"
									onClick={() => props.onOpenSet(set)}
									aria-label={text("client.grid.rest-label", { index: number, rest: restText })}
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
							</Collapse>
						</div>
					);
				})}
			</MotionList>
		</div>
	);
}
