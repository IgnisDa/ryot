import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { useRyot, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	Dialog,
	Field,
	FieldMessage,
	SegmentedControl,
	TextField,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useState } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import {
	ExerciseOverrideUpdateInputSchema,
	ExerciseOverrideUpdateOutputSchema,
	exerciseOverrideUpdateOperationSlug,
} from "../../shared/workout-editor-context-operations";
import type {
	WorkoutEditorDisplay,
	WorkoutEditorOccurrence,
} from "../../shared/workout-editor-draft";
import { WorkoutExerciseOverridesSchema } from "../../shared/workout-editor-preferences";
import { requiredWorkoutMeasurementsByKind } from "../../shared/workout-set";
import type { EditorExercise } from "./queries";

const restFields = ["normalRestTime", "warmUpRestTime", "dropRestTime", "failureRestTime"] as const;

const restLabels: Record<(typeof restFields)[number], string> = {
	dropRestTime: "Drop set rest (seconds)",
	normalRestTime: "Normal rest (seconds)",
	warmUpRestTime: "Warm-up rest (seconds)",
	failureRestTime: "Failure rest (seconds)",
};

const sectionHeading = "text-[11px] font-semibold tracking-wider text-text-subtle uppercase";

const validRest = (value: string | undefined) =>
	value === undefined || value.trim() === "" || /^\d+$/.test(value.trim());

export function UnitsAndDefaultsSheet(props: {
	readonly compact: boolean;
	readonly safeAreaBottom: number;
	readonly exercise: EditorExercise;
	readonly occurrence: WorkoutEditorOccurrence;
	readonly onDisplay: (display: WorkoutEditorDisplay) => void;
	readonly onClose: () => void;
	readonly onSaved: () => void;
}) {
	const client = useRyot();
	const schedule = useRyotSchedule();
	const [values, setValues] = useState(() =>
		Object.fromEntries(
			restFields.map((field) => [
				field,
				props.exercise.overrides[field] == null ? "" : String(props.exercise.overrides[field]),
			]),
		),
	);
	const [duration, setDuration] = useState(
		props.exercise.overrides.defaultDurationUnit ?? "inherited",
	);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string>();
	const save = () => {
		const set = Schema.decodeUnknownResult(WorkoutExerciseOverridesSchema)({
			...Object.fromEntries(
				restFields.flatMap((field) =>
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
			exerciseId: props.exercise.id,
			remove: [
				...restFields.filter((field) => !values[field]?.trim()),
				...(duration === "inherited" ? ["defaultDurationUnit"] : []),
			],
		});
		if (decoded._tag === "Failure") {
			setError("These defaults are invalid.");
			return;
		}
		setPending(true);
		schedule.run(
			Schema.encodeEffect(Schema.toCodecJson(ExerciseOverrideUpdateInputSchema))(
				decoded.success,
			).pipe(
				Effect.flatMap((input) =>
					client.operations.invoke({
						input,
						packageId: PLUGIN_PACKAGE_ID,
						slug: exerciseOverrideUpdateOperationSlug,
						output: ExerciseOverrideUpdateOutputSchema,
					}),
				),
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
	const fields = requiredWorkoutMeasurementsByKind[props.occurrence.exerciseKind];
	const display = props.occurrence.display ?? {
		weightUnit: "kg",
		distanceUnit: "km",
		durationUnit: "minutes",
	};
	return (
		<Dialog
			dismissible={!pending}
			onClose={props.onClose}
			title="Units and rest defaults"
			description={props.exercise.name}
			safeAreaBottom={props.safeAreaBottom}
			closeLabel="Close units and rest defaults"
			closeIcon={<AppIcon name="x" size={18} />}
			placement={props.compact ? "sheet" : "side"}
			footer={
				<>
					<Button disabled={pending} variant="secondary" onClick={props.onClose}>
						Cancel
					</Button>
					<Button onClick={save} loading={pending}>
						Save defaults
					</Button>
				</>
			}
		>
			<div className="grid gap-6">
				<section className="grid gap-2.5">
					<h3 className={sectionHeading}>Units in this workout</h3>
					{fields.includes("weight") ? (
						<SegmentedControl
							className="w-full"
							label="Weight unit"
							value={display.weightUnit}
							optionClassName="flex-1 px-3"
							onChange={(weightUnit) => props.onDisplay({ ...display, weightUnit })}
							options={[
								{ value: "kg", label: "Kilograms", content: "Kilograms" },
								{ value: "lb", label: "Pounds", content: "Pounds" },
							]}
						/>
					) : null}
					{fields.includes("distance") ? (
						<SegmentedControl
							className="w-full"
							label="Distance unit"
							value={display.distanceUnit}
							optionClassName="flex-1 px-3"
							onChange={(distanceUnit) => props.onDisplay({ ...display, distanceUnit })}
							options={[
								{ value: "km", label: "Kilometres", content: "Kilometres" },
								{ value: "mi", label: "Miles", content: "Miles" },
							]}
						/>
					) : null}
					{fields.includes("duration") ? (
						<SegmentedControl
							className="w-full"
							label="Duration unit"
							value={display.durationUnit}
							optionClassName="flex-1 px-3"
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
				<fieldset disabled={pending} className="grid min-w-0 gap-3 border-0 p-0">
					<legend className={sectionHeading}>Defaults for every workout</legend>
					<p className="text-xs text-text-muted">
						Blank uses your Fitness settings. 0 turns rest off. Sets with their own rest keep it.
					</p>
					{restFields.map((field) => (
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
					{fields.includes("duration") ? (
						<div className="grid gap-1.5">
							<span className="text-[13px] font-medium">Default duration unit</span>
							<SegmentedControl
								value={duration}
								className="w-full"
								onChange={setDuration}
								label="Default duration unit"
								optionClassName="flex-1 px-2"
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
			</div>
		</Dialog>
	);
}
