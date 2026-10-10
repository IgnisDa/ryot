import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { useRyot, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import { Button, Modal, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { useState } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import {
	ExerciseOverrideUpdateInputSchema,
	ExerciseOverrideUpdateOutputSchema,
	exerciseOverrideUpdateOperationSlug,
} from "../../shared/workout-editor-context-operations";
import { WorkoutExerciseOverridesSchema } from "../../shared/workout-editor-preferences";
import { EditorField, EditorSelect, editorModalClass } from "./controls";
import type { EditorExercise } from "./queries";

const restFields = ["normalRestTime", "warmUpRestTime", "dropRestTime", "failureRestTime"] as const;

export function ExerciseDefaultsOverlay(props: {
	readonly exercise: EditorExercise;
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
			setError("Enter nonnegative whole seconds, or leave a field blank to inherit.");
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
	return (
		<Modal
			dismissible={!pending}
			onClose={props.onClose}
			label="Exercise defaults"
			closeLabel="Close defaults"
			className={editorModalClass}
		>
			<h2 className="text-xl font-semibold">Defaults for {props.exercise.name}</h2>
			<p>
				Blank rest values inherit your Fitness settings. Zero disables rest. Existing explicit set
				values will not change.
			</p>
			<fieldset disabled={pending} className="flex flex-col gap-3">
				{restFields.map((field) => (
					<EditorField
						numeric
						key={field}
						value={values[field]}
						label={field.replaceAll(/([A-Z])/g, " $1")}
						onChange={(value) => setValues((previous) => ({ ...previous, [field]: value }))}
					/>
				))}
				<EditorSelect
					value={duration}
					onChange={setDuration}
					label="Default duration unit"
					choices={[
						{ label: "Inherit", value: "inherited" },
						{ value: "seconds", label: "Seconds" },
						{ value: "minutes", label: "Minutes" },
					]}
				/>
			</fieldset>
			{error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
			<Button onClick={save} disabled={pending}>
				{pending ? "Saving…" : "Save defaults"}
			</Button>
			<Button disabled={pending} variant="secondary" onClick={props.onClose}>
				Cancel
			</Button>
		</Modal>
	);
}
