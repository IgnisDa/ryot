import { RyotClientError, type RyotClient } from "@ryot-app/plugin-client-sdk";
import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import {
	createRyotMutation,
	createRyotQuery,
	useRyotQuery,
	useRyotSubmission,
	type RyotSubmission,
} from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	Dialog,
	Field,
	Notice,
	SegmentedControl,
	TextField,
} from "@ryot-app/plugin-ui-sdk";
import { useEffect, useState } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { workoutTimeCorrectionOperationSlug } from "../../shared/workout-editor-context-operations";
import {
	WorkoutPropertiesSchema,
	type WorkoutProperties,
} from "../../shared/workout-editor-properties";
import {
	encodeWorkoutEditorBaseline,
	workoutEditorEntityRecipe,
	type WorkoutEditorBaseline,
} from "../../shared/workout-editor-recipes";
import {
	WorkoutTimeCorrectionInputSchema,
	WorkoutTimeCorrectionOutputSchema,
} from "../../shared/workout-time-operations";
import { fromDateTimeInput, toDateTimeInput } from "../datetime-input";

type Correction = Omit<
	typeof WorkoutTimeCorrectionInputSchema.Type,
	"submittedAt" | "submissionId"
>;
const correctTime = createRyotMutation<
	RyotSubmission<Correction>,
	typeof WorkoutTimeCorrectionOutputSchema.Type
>(({ input, client }) =>
	client.operations.invoke({
		packageId: PLUGIN_PACKAGE_ID,
		slug: workoutTimeCorrectionOperationSlug,
		output: WorkoutTimeCorrectionOutputSchema,
		inputSchema: WorkoutTimeCorrectionInputSchema,
		input: { ...input.input, submittedAt: input.submittedAt, submissionId: input.submissionId },
	}),
);
const timeSourceQuery = () =>
	createRyotQuery(({ input, client }: { readonly client: RyotClient; readonly input: string }) =>
		Effect.gen(function* () {
			const entity = yield* client.data.query(
				workoutEditorEntityRecipe({
					entityId: input,
					kind: "workout",
					reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
				}),
			);
			if (entity === null) {
				return null;
			}
			const properties = yield* Schema.decodeUnknownEffect(WorkoutPropertiesSchema)(
				entity.properties,
			).pipe(Effect.mapError(() => new RyotClientError("malformed-result")));
			return { entity, properties };
		}),
	);

function TimeForm(props: {
	readonly onClose: () => void;
	readonly properties: WorkoutProperties;
	readonly entity: WorkoutEditorBaseline["entity"];
}) {
	const { entity, onClose, properties } = props;
	const [start, setStart] = useState(toDateTimeInput(properties.startedAt));
	const [end, setEnd] = useState(properties.endedAt ? toDateTimeInput(properties.endedAt) : "");
	const [intent, setIntent] = useState("preserve");
	const [seconds, setSeconds] = useState(String(properties.activeDuration ?? ""));
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
		const startedAt = fromDateTimeInput(start, properties.startedAt);
		const endedAt = end === "" ? undefined : fromDateTimeInput(end, properties.endedAt);
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
		<Dialog
			onClose={onClose}
			title="Adjust workout time"
			dismissible={!save.isPending}
			closeLabel="Close time correction"
			description="Change session timestamps only. Set, confirmation, and rest-start times stay unchanged."
			footer={
				<Button
					onClick={save.status === "retained" ? save.retry : submit}
					disabled={
						save.isPending || save.data?.kind === "conflict" || save.data?.kind === "invalid"
					}
				>
					{submitLabel}
				</Button>
			}
		>
			<div className="grid gap-4">
				<fieldset
					className="grid min-w-0 gap-4 border-0 p-0"
					disabled={save.isPending || save.status === "retained"}
				>
					<Field label="Start time">
						{(control) => (
							<TextField
								{...control}
								value={start}
								type="datetime-local"
								onChange={(event) => setStart(event.target.value)}
							/>
						)}
					</Field>
					<Field label="End time">
						{(control) => (
							<TextField
								{...control}
								value={end}
								type="datetime-local"
								onChange={(event) => setEnd(event.target.value)}
							/>
						)}
					</Field>
					<div className="grid gap-1.5">
						<span className="text-[13px] font-medium">Active duration</span>
						<SegmentedControl
							value={intent}
							className="w-full"
							onChange={setIntent}
							label="Active duration"
							optionClassName="flex-1 px-2"
							options={[
								{ content: "Keep", value: "preserve", label: "Keep recorded duration" },
								{ value: "set", content: "Set", label: "Set duration" },
								{ value: "clear", content: "Clear", label: "Clear to unknown" },
							]}
						/>
					</div>
					{intent === "set" ? (
						<Field label="Active duration (seconds)">
							{(control) => (
								<TextField
									{...control}
									value={seconds}
									inputMode="numeric"
									onChange={(event) => setSeconds(event.target.value)}
								/>
							)}
						</Field>
					) : null}
				</fieldset>
				{message ? <Notice tone="danger">{message}</Notice> : null}
				{save.error ? (
					<Notice tone="danger">
						The result could not be confirmed. Retry the same correction.
					</Notice>
				) : null}
				{save.data?.kind === "conflict" ? (
					<Notice tone="danger">
						This workout changed. Close and reopen Adjust time to load the saved version.
					</Notice>
				) : null}
				{save.data?.kind === "invalid" ? (
					<Notice tone="danger">
						This correction is invalid. Close and reopen the form to try again.
					</Notice>
				) : null}
			</div>
		</Dialog>
	);
}

export function AdjustWorkoutTime(props: {
	readonly entityId: string;
	readonly onClose: () => void;
}) {
	const [query] = useState(timeSourceQuery);
	const source = useRyotQuery(query, props.entityId, { refreshOnMutation: false });
	if (source.data) {
		return (
			<TimeForm
				onClose={props.onClose}
				entity={source.data.entity}
				properties={source.data.properties}
			/>
		);
	}
	return (
		<Dialog onClose={props.onClose} title="Adjust workout time" closeLabel="Close time correction">
			{source.isError ? (
				<Notice
					tone="danger"
					action={
						<Button size="sm" variant="secondary" onClick={source.refetch}>
							Retry times
						</Button>
					}
				>
					Workout times could not be loaded.
				</Notice>
			) : (
				<p role="status" className="text-text-muted">
					{source.data === null ? "This workout no longer exists." : "Loading workout times…"}
				</p>
			)}
		</Dialog>
	);
}
