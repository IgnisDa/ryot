import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { formatError, useRyot, useRyotSchedule, useT } from "@ryot-app/plugin-client-sdk/react";
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
import { type FitnessText, useFitnessMessages } from "../messages";
import { occurrenceDisplay } from "./draft-ops";
import { EditorSheet } from "./editor-sheet";
import type { EditorExercise } from "./queries";

const restLabel = (text: FitnessText, field: WorkoutRestField) =>
	text("client.prefs.rest-label", { field });

const sectionHeading = "text-[11px] font-semibold tracking-wider text-text-subtle uppercase";

const validRest = (value: string | undefined) =>
	value === undefined || value.trim() === "" || /^\d+$/.test(value.trim());

type ExerciseDefaults = ReturnType<typeof useExerciseDefaults>;

type ExerciseDefaultsProps = {
	readonly exerciseId: string;
	readonly onSaved: () => void;
	readonly onClose: () => void;
	readonly exerciseName: string;
	readonly exerciseKind: ExerciseKind;
	readonly overrides: WorkoutExerciseOverrides;
};

export function ExerciseDefaultsSheet(props: ExerciseDefaultsProps) {
	const text = useFitnessMessages();
	const defaults = useExerciseDefaults(props);
	return (
		<EditorSheet
			wide="side"
			onClose={props.onClose}
			dismissible={!defaults.pending}
			description={props.exerciseName}
			title={text("client.prefs.title")}
			closeLabel={text("client.prefs.close")}
			footer={<DefaultsActions defaults={defaults} onClose={props.onClose} />}
		>
			<div className="grid gap-6">
				<ExerciseDefaultsForm defaults={defaults} exerciseKind={props.exerciseKind} />
			</div>
		</EditorSheet>
	);
}

export function UnitsAndDefaultsSheet(props: {
	readonly onClose: () => void;
	readonly onSaved: () => void;
	readonly exercise: EditorExercise;
	readonly occurrence: WorkoutEditorOccurrence;
	readonly onDisplay: (display: WorkoutEditorDisplay) => void;
}) {
	const text = useFitnessMessages();
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
			description={props.exercise.name}
			title={text("client.card.defaults")}
			closeLabel={text("client.prefs.units-close")}
			footer={<DefaultsActions defaults={defaults} onClose={props.onClose} />}
		>
			<div className="grid gap-6">
				<section className="grid gap-2.5">
					<h3 className={sectionHeading}>{text("client.prefs.units")}</h3>
					{fields.includes("weight") ? (
						<SegmentedControl
							fill
							optionClassName="px-3"
							value={display.weightUnit}
							label={text("client.prefs.weight-unit")}
							onChange={(weightUnit) => props.onDisplay({ ...display, weightUnit })}
							options={[
								{
									value: "kg",
									label: text("client.prefs.kilograms"),
									content: text("client.prefs.kilograms"),
								},
								{
									value: "lb",
									label: text("client.prefs.pounds"),
									content: text("client.prefs.pounds"),
								},
							]}
						/>
					) : null}
					{fields.includes("distance") ? (
						<SegmentedControl
							fill
							optionClassName="px-3"
							value={display.distanceUnit}
							label={text("client.prefs.distance-unit")}
							onChange={(distanceUnit) => props.onDisplay({ ...display, distanceUnit })}
							options={[
								{
									value: "km",
									label: text("client.prefs.kilometres"),
									content: text("client.prefs.kilometres"),
								},
								{
									value: "mi",
									label: text("client.prefs.miles"),
									content: text("client.prefs.miles"),
								},
							]}
						/>
					) : null}
					{fields.includes("duration") ? (
						<SegmentedControl
							fill
							optionClassName="px-3"
							value={display.durationUnit}
							label={text("property.duration-unit")}
							onChange={(durationUnit) => props.onDisplay({ ...display, durationUnit })}
							options={[
								{
									value: "minutes",
									label: text("client.prefs.minutes"),
									content: text("client.prefs.minutes"),
								},
								{
									value: "seconds",
									label: text("client.prefs.seconds"),
									content: text("client.prefs.seconds"),
								},
							]}
						/>
					) : null}
					<p className="text-xs text-text-muted">{text("client.prefs.units-note")}</p>
				</section>
				<ExerciseDefaultsForm defaults={defaults} exerciseKind={props.occurrence.exerciseKind} />
			</div>
		</EditorSheet>
	);
}

function DefaultsActions(props: {
	readonly onClose: () => void;
	readonly defaults: ExerciseDefaults;
}) {
	const text = useFitnessMessages();
	return (
		<>
			<Button variant="secondary" onClick={props.onClose} disabled={props.defaults.pending}>
				{text("common.action.cancel")}
			</Button>
			<Button onClick={props.defaults.save} loading={props.defaults.pending}>
				{text("client.prefs.save")}
			</Button>
		</>
	);
}

function ExerciseDefaultsForm(props: {
	readonly defaults: ExerciseDefaults;
	readonly exerciseKind: ExerciseKind;
}) {
	const text = useFitnessMessages();
	const { error, values, pending, duration, setValues, setDuration } = props.defaults;
	return (
		<>
			<fieldset disabled={pending} className="grid min-w-0 gap-3 border-0 p-0">
				<legend className={sectionHeading}>{text("client.prefs.defaults")}</legend>
				<p className="text-xs text-text-muted">{text("client.prefs.defaults-note")}</p>
				{workoutRestFields.map((field) => (
					<Field key={field} label={restLabel(text, field)}>
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
						<span className="text-[13px] font-medium">{text("client.prefs.default-duration")}</span>
						<SegmentedControl
							fill
							value={duration}
							onChange={setDuration}
							optionClassName="px-2"
							label={text("client.prefs.default-duration")}
							options={[
								{
									value: "inherited",
									label: text("client.prefs.inherited"),
									content: text("client.prefs.inherited"),
								},
								{
									value: "seconds",
									label: text("client.prefs.seconds"),
									content: text("client.prefs.seconds"),
								},
								{
									value: "minutes",
									label: text("client.prefs.minutes"),
									content: text("client.prefs.minutes"),
								},
							]}
						/>
					</div>
				) : null}
			</fieldset>
			{error === undefined ? null : <FieldMessage>{error}</FieldMessage>}
		</>
	);
}

function useExerciseDefaults(
	props: Pick<ExerciseDefaultsProps, "onSaved" | "onClose" | "overrides" | "exerciseId">,
) {
	const t = useT();
	const text = useFitnessMessages();
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
		const overrides = Schema.decodeUnknownResult(WorkoutExerciseOverridesSchema)({
			...Object.fromEntries(
				workoutRestFields.map((field) => [
					field,
					values[field]?.trim() ? Number(values[field].trim()) : null,
				]),
			),
			defaultDurationUnit: duration === "inherited" ? null : duration,
		});
		if (overrides._tag === "Failure") {
			setError(text("client.prefs.invalid-rest"));
			return;
		}
		const decoded = Schema.decodeResult(ExerciseOverrideUpdateInputSchema)({
			overrides: overrides.success,
			exerciseId: props.exerciseId,
		});
		if (decoded._tag === "Failure") {
			setError(text("client.prefs.invalid"));
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
						onSuccess: () => {
							props.onSaved();
							props.onClose();
						},
						onFailure: (failure) =>
							setError(formatError(t, failure, text("client.prefs.save-failed"))),
					}),
					Effect.asVoid,
				),
			() => setPending(false),
		);
	};
	return { save, error, values, pending, duration, setValues, setDuration };
}
