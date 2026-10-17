import { RyotClientError, type RyotClient } from "@ryot-app/plugin-client-sdk";
import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import {
	createRyotMutation,
	createRyotQuery,
	useRyotQuery,
	useRyotSubmission,
	type RyotSubmission,
} from "@ryot-app/plugin-client-sdk/react";
import { Button, Modal, StatusMessage, TextField } from "@ryot-app/plugin-ui-sdk";
import { useEffect, useState } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { workoutTimeCorrectionOperationSlug } from "../../shared/workout-editor-context-operations";
import {
	encodeWorkoutEditorBaseline,
	workoutEditorEntityRecipe,
	type WorkoutEditorBaseline,
} from "../../shared/workout-editor-recipes";
import {
	WorkoutTimeCorrectionInputSchema,
	WorkoutTimeCorrectionOutputSchema,
} from "../../shared/workout-time-operations";
import { EditorSelect, editorModalClass } from "../workout-editor/controls";

type Correction = Omit<
	typeof WorkoutTimeCorrectionInputSchema.Type,
	"submittedAt" | "submissionId"
>;
const correctTime = createRyotMutation<
	RyotSubmission<Correction>,
	typeof WorkoutTimeCorrectionOutputSchema.Type
>(({ input, client }) =>
	Schema.encodeEffect(Schema.toCodecJson(WorkoutTimeCorrectionInputSchema))({
		...input.input,
		submittedAt: input.submittedAt,
		submissionId: input.submissionId,
	}).pipe(
		Effect.mapError(() => new RyotClientError("invalid-input")),
		Effect.flatMap((payload) =>
			client.operations.invoke({
				input: payload,
				packageId: PLUGIN_PACKAGE_ID,
				slug: workoutTimeCorrectionOperationSlug,
				output: WorkoutTimeCorrectionOutputSchema,
			}),
		),
	),
);
const timeSourceQuery = () =>
	createRyotQuery(({ input, client }: { readonly client: RyotClient; readonly input: string }) =>
		client.data.query(
			workoutEditorEntityRecipe({
				entityId: input,
				kind: "workout",
				reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
			}),
		),
	);

const pad = (value: number) => String(value).padStart(2, "0");
const timeCorrectionInputValue = (iso: string) => {
	const date = new Date(iso);
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

function TimeForm(props: {
	readonly entity: WorkoutEditorBaseline["entity"];
	readonly onClose: () => void;
}) {
	const { entity, onClose } = props;
	const originalStart =
		typeof entity.properties["startedAt"] === "string" ? entity.properties["startedAt"] : "";
	const originalEnd =
		typeof entity.properties["endedAt"] === "string" ? entity.properties["endedAt"] : "";
	const initialStart = originalStart === "" ? "" : timeCorrectionInputValue(originalStart);
	const initialEnd = originalEnd === "" ? "" : timeCorrectionInputValue(originalEnd);
	const [start, setStart] = useState(initialStart);
	const [end, setEnd] = useState(initialEnd);
	const [intent, setIntent] = useState("preserve");
	const [seconds, setSeconds] = useState(
		typeof entity.properties["activeDuration"] === "number"
			? String(entity.properties["activeDuration"])
			: "",
	);
	const [message, setMessage] = useState<string>();
	const save = useRyotSubmission(correctTime, { isComplete: (result) => result.kind === "saved" });
	useEffect(() => {
		if (save.data?.kind === "saved") {
			onClose();
		}
	}, [save.data, onClose]);
	const submit = () => {
		if (
			start === "" ||
			!Number.isFinite(Date.parse(start)) ||
			(end !== "" && !Number.isFinite(Date.parse(end)))
		) {
			setMessage("Enter valid dates and times.");
			return;
		}
		const startedAt = start === initialStart ? originalStart : new Date(start).toISOString();
		let endedAt: string | undefined;
		if (end !== "") {
			endedAt = end === initialEnd ? originalEnd : new Date(end).toISOString();
		}
		if (
			(endedAt !== undefined && Date.parse(endedAt) < Date.parse(startedAt)) ||
			(intent === "set" &&
				(seconds.trim() === "" || !Number.isSafeInteger(Number(seconds)) || Number(seconds) < 0))
		) {
			setMessage("Enter valid times and a nonnegative whole active duration.");
			return;
		}
		let activeDuration: Correction["activeDuration"] = { kind: "preserve" };
		if (intent === "set") {
			activeDuration = { kind: "set", seconds: Number(seconds) };
		}
		if (intent === "clear") {
			activeDuration = { kind: "clear" };
		}
		save.submit({
			endedAt,
			startedAt,
			activeDuration,
			entityId: entity.id,
			conflictToken: encodeWorkoutEditorBaseline({ entity, sets: [] }),
		});
	};
	let submitLabel = "Save time correction";
	if (save.status === "retained") {
		submitLabel = "Retry correction";
	}
	if (save.isPending) {
		submitLabel = "Saving…";
	}
	return (
		<Modal
			onClose={onClose}
			label="Adjust workout time"
			className={editorModalClass}
			dismissible={!save.isPending}
			closeLabel="Close time correction"
		>
			<h2>Adjust workout time</h2>
			<p>Change session timestamps only. Set, confirmation, and rest-start times stay unchanged.</p>
			<fieldset
				className="flex flex-col gap-3"
				disabled={save.isPending || save.status === "retained"}
			>
				<label>
					Start time
					<TextField
						value={start}
						type="datetime-local"
						onChange={(event) => setStart(event.target.value)}
					/>
				</label>
				<label>
					End time
					<TextField
						value={end}
						type="datetime-local"
						onChange={(event) => setEnd(event.target.value)}
					/>
				</label>
				<EditorSelect
					value={intent}
					onChange={setIntent}
					label="Active duration"
					choices={[
						{ value: "preserve", label: "Keep recorded duration" },
						{ value: "set", label: "Set duration" },
						{ value: "clear", label: "Clear to unknown" },
					]}
				/>
				{intent === "set" ? (
					<label>
						Active duration (seconds)
						<TextField
							value={seconds}
							inputMode="numeric"
							onChange={(event) => setSeconds(event.target.value)}
						/>
					</label>
				) : null}
			</fieldset>
			{message ? <StatusMessage tone="error">{message}</StatusMessage> : null}
			{save.error ? (
				<StatusMessage tone="error">
					The result could not be confirmed. Retry the same correction.
				</StatusMessage>
			) : null}
			{save.data?.kind === "conflict" ? (
				<StatusMessage tone="error">
					This workout changed. Close and reopen Adjust time to load the saved version.
				</StatusMessage>
			) : null}
			{save.data?.kind === "invalid" ? (
				<StatusMessage tone="error">
					This correction is invalid. Close and reopen the form to try again.
				</StatusMessage>
			) : null}
			<Button
				onClick={save.status === "retained" ? save.retry : submit}
				disabled={save.isPending || save.data?.kind === "conflict" || save.data?.kind === "invalid"}
			>
				{submitLabel}
			</Button>
		</Modal>
	);
}

export function AdjustWorkoutTime(props: {
	readonly entityId: string;
	readonly onClose: () => void;
}) {
	const [query] = useState(timeSourceQuery);
	const source = useRyotQuery(query, props.entityId, { refreshOnMutation: false });
	if (source.data) {
		return <TimeForm entity={source.data} onClose={props.onClose} />;
	}
	return (
		<Modal
			onClose={props.onClose}
			label="Adjust workout time"
			className={editorModalClass}
			closeLabel="Close time correction"
		>
			<h2>Adjust workout time</h2>
			{source.isError ? (
				<>
					<StatusMessage tone="error">Workout times could not be loaded.</StatusMessage>
					<Button onClick={source.refetch}>Retry times</Button>
				</>
			) : (
				<StatusMessage tone="pending">
					{source.data === null ? "This workout no longer exists." : "Loading workout times…"}
				</StatusMessage>
			)}
		</Modal>
	);
}
