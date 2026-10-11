import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { useRyot, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import { Button, Field, FieldMessage, SegmentedControl, TextField } from "@ryot-app/plugin-ui-sdk";
import { useState } from "react";

import type { ExerciseKind } from "../../shared/exercise-kinds";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import {
	ExerciseOverrideUpdateInputSchema,
	exerciseOverrideUpdateOperationSlug,
	ExerciseOverrideUpdateOutputSchema,
} from "../../shared/workout-editor-context-operations";
import type {
	WorkoutEditorDisplay,
	WorkoutEditorOccurrence,
} from "../../shared/workout-editor-draft";
import {
	type WorkoutExerciseOverrides,
	WorkoutExerciseOverridesSchema,
	type WorkoutRestField,
	workoutRestFields,
} from "../../shared/workout-editor-preferences";
import { requiredWorkoutMeasurementsByKind } from "../../shared/workout-set";
import { occurrenceDisplay } from "./draft-ops";
import { EditorSheet } from "./editor-sheet";
import type { EditorExercise } from "./queries";

const restLabels: Record<WorkoutRestField, string> = {
	dropRestTime: "Drop set rest (seconds)",
	normalRestTime: "Normal rest (seconds)",
	warmUpRestTime: "Warm-up rest (seconds)",
	failureRestTime: "Failure rest (seconds)",
};

const sectionHeading = "text-[11px] font-semibold tracking-wider text-text-subtle uppercase";

const validRest = (value: string | undefined) =>
	value === undefined || value.trim() === "" || /^\d+$/.test(value.trim());

type ExerciseDefaultsProps = {
	readonly exerciseId: string;
	readonly exerciseName: string;
	readonly exerciseKind: ExerciseKind;
	readonly overrides: WorkoutExerciseOverrides;
	readonly onSaved: () => void;
	readonly onClose: () => void;
};

function useExerciseDefaults(
	props: Pick<ExerciseDefaultsProps, "exerciseId" | "overrides" | "onSaved" | "onClose">,
) {
	const client = useRyot();
	const schedule = useRyotSchedule();
	const [values, setValues] = useState(() =>
		Object.fromEntries(
			workoutRestFields.map((field) => [
				field,
				props.overrides[field] == null ? "" : String(props.overrides[field]),
			]),
		),
	);
	const [duration, setDuration] = useState(props.overrides.defaultDurationUnit ?? "inherited");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string>();
	const save = () => {
		const set = Schema.decodeUnknownResult(WorkoutExerciseOverridesSchema)({
			...Object.fromEntries(
				workoutRestFields.flatMap((field) =>
					values[field]?.trim() ? [[field, Number(values[field])]] : [],
				),
			),
			...(duration === "inherited" ? {} : { defaultDurationUnit: duration }),
		});
		if (set._tag === "Failure") {
			setError(
				"Enter whole seconds of 0 or more, or leave a field blank to use your Fitness settings.",
			);
			return;
		}
		const decoded = Schema.decodeUnknownResult(ExerciseOverrideUpdateInputSchema)({
			set: set.success,
			exerciseId: props.exerciseId,
			remove: [
				...workoutRestFields.filter((field) => !values[field]?.trim()),
				...(duration === "inherited" ? ["defaultDurationUnit"] : []),
			],
		});
		if (decoded._tag === "Failure") {
			setError("These defaults are invalid.");
			return;
		}
		setPending(true);
		schedule.run(
			client.operations
				.invoke({
					input: decoded.success,
					packageId: PLUGIN_PACKAGE_ID,
					slug: exerciseOverrideUpdateOperationSlug,
					output: ExerciseOverrideUpdateOutputSchema,
					inputSchema: ExerciseOverrideUpdateInputSchema,
				})
				.pipe(
					Effect.match({
						onFailure: () => setError("Defaults could not be saved. Try again."),
						onSuccess: (result) => {
							if (result.kind === "saved") {
								props.onSaved();
								props.onClose();
							} else {
								setError("This exercise is unavailable or the defaults are invalid.");
							}
						},
					}),
					Effect.asVoid,
				),
			() => setPending(false),
		);
	};
	return { save, error, values, pending, duration, setValues, setDuration };
}

type ExerciseDefaults = ReturnType<typeof useExerciseDefaults>;

function ExerciseDefaultsForm(props: {
	readonly defaults: ExerciseDefaults;
	readonly exerciseKind: ExerciseKind;
}) {
	const { error, values, pending, duration, setValues, setDuration } = props.defaults;
	return (
		<>
			<fieldset disabled={pending} className="grid min-w-0 gap-3 border-0 p-0">
				<legend className={sectionHeading}>Defaults for every workout</legend>
				<p className="text-xs text-text-muted">
					Blank uses your Fitness settings. 0 turns rest off. Sets with their own rest keep it.
				</p>
				{workoutRestFields.map((field) => (
					<Field key={field} label={restLabels[field]}>
						{(control) => (
							<TextField
								{...control}
								inputMode="numeric"
								value={values[field] ?? ""}
								invalid={error !== undefined && !validRest(values[field])}
								onChange={(event) =>
									setValues((previous) => ({ ...previous, [field]: event.target.value }))
								}
							/>
						)}
					</Field>
				))}
				{requiredWorkoutMeasurementsByKind[props.exerciseKind].includes("duration") ? (
					<div className="grid gap-1.5">
						<span className="text-[13px] font-medium">Default duration unit</span>
						<SegmentedControl
							fill
							value={duration}
							onChange={setDuration}
							optionClassName="px-2"
							label="Default duration unit"
							options={[
								{ value: "inherited", label: "Fitness setting", content: "Fitness setting" },
								{ value: "seconds", label: "Seconds", content: "Seconds" },
								{ value: "minutes", label: "Minutes", content: "Minutes" },
							]}
						/>
					</div>
				) : null}
			</fieldset>
			{error === undefined ? null : <FieldMessage>{error}</FieldMessage>}
		</>
	);
}

function DefaultsActions(props: {
	readonly defaults: ExerciseDefaults;
	readonly onClose: () => void;
}) {
	return (
		<>
			<Button variant="secondary" onClick={props.onClose} disabled={props.defaults.pending}>
				Cancel
			</Button>
			<Button onClick={props.defaults.save} loading={props.defaults.pending}>
				Save defaults
			</Button>
		</>
	);
}

export function ExerciseDefaultsSheet(props: ExerciseDefaultsProps) {
	const defaults = useExerciseDefaults(props);
	return (
		<EditorSheet
			wide="side"
			onClose={props.onClose}
			title="Exercise preferences"
			dismissible={!defaults.pending}
			description={props.exerciseName}
			closeLabel="Close exercise preferences"
			footer={<DefaultsActions defaults={defaults} onClose={props.onClose} />}
		>
			<div className="grid gap-6">
				<ExerciseDefaultsForm defaults={defaults} exerciseKind={props.exerciseKind} />
			</div>
		</EditorSheet>
	);
}

export function UnitsAndDefaultsSheet(props: {
	readonly exercise: EditorExercise;
	readonly occurrence: WorkoutEditorOccurrence;
	readonly onDisplay: (display: WorkoutEditorDisplay) => void;
	readonly onClose: () => void;
	readonly onSaved: () => void;
}) {
	const defaults = useExerciseDefaults({
		onSaved: props.onSaved,
		onClose: props.onClose,
		exerciseId: props.exercise.id,
		overrides: props.exercise.overrides,
	});
	const fields = requiredWorkoutMeasurementsByKind[props.occurrence.exerciseKind];
	const display = occurrenceDisplay(props.occurrence);
	return (
		<EditorSheet
			wide="side"
			onClose={props.onClose}
			dismissible={!defaults.pending}
			title="Units and rest defaults"
			description={props.exercise.name}
			closeLabel="Close units and rest defaults"
			footer={<DefaultsActions defaults={defaults} onClose={props.onClose} />}
		>
			<div className="grid gap-6">
				<section className="grid gap-2.5">
					<h3 className={sectionHeading}>Units in this workout</h3>
					{fields.includes("weight") ? (
						<SegmentedControl
							fill
							label="Weight unit"
							optionClassName="px-3"
							value={display.weightUnit}
							onChange={(weightUnit) => props.onDisplay({ ...display, weightUnit })}
							options={[
								{ value: "kg", label: "Kilograms", content: "Kilograms" },
								{ value: "lb", label: "Pounds", content: "Pounds" },
							]}
						/>
					) : null}
					{fields.includes("distance") ? (
						<SegmentedControl
							fill
							label="Distance unit"
							optionClassName="px-3"
							value={display.distanceUnit}
							onChange={(distanceUnit) => props.onDisplay({ ...display, distanceUnit })}
							options={[
								{ value: "km", label: "Kilometres", content: "Kilometres" },
								{ value: "mi", label: "Miles", content: "Miles" },
							]}
						/>
					) : null}
					{fields.includes("duration") ? (
						<SegmentedControl
							fill
							label="Duration unit"
							optionClassName="px-3"
							value={display.durationUnit}
							onChange={(durationUnit) => props.onDisplay({ ...display, durationUnit })}
							options={[
								{ value: "minutes", label: "Minutes", content: "Minutes" },
								{ value: "seconds", label: "Seconds", content: "Seconds" },
							]}
						/>
					) : null}
					<p className="text-xs text-text-muted">
						Changes how values show here. Entered values are converted, not changed.
					</p>
				</section>
				<ExerciseDefaultsForm defaults={defaults} exerciseKind={props.occurrence.exerciseKind} />
			</div>
		</EditorSheet>
	);
}
