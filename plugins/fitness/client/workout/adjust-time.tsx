import { type RyotClient, RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect, Result, Schema } from "@ryot-app/plugin-client-sdk/effect";
import {
	createRyotMutation,
	createRyotQuery,
	type RyotSubmission,
	useRyotQuery,
	useRyotSubmission,
} from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	DateTimeField,
	Dialog,
	Field,
	Notice,
	SegmentedControl,
	TextField,
	useDateTimeInput,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useEffect, useState } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { workoutTimeCorrectionOperationSlug } from "../../shared/workout-editor-context-operations";
import {
	type WorkoutProperties,
	WorkoutPropertiesSchema,
} from "../../shared/workout-editor-properties";
import {
	encodeWorkoutEditorBaseline,
	type WorkoutEditorBaseline,
	workoutEditorEntityRecipe,
} from "../../shared/workout-editor-recipes";
import {
	WorkoutTimeCorrectionInputSchema,
	WorkoutTimeCorrectionOutputSchema,
} from "../../shared/workout-time-operations";
import { useFitnessMessages } from "../messages";

type Correction = Omit<
	typeof WorkoutTimeCorrectionInputSchema.Type,
	"submittedAt" | "submissionId"
>;

const correctTime = createRyotMutation<
	RyotSubmission<Correction>,
	typeof WorkoutTimeCorrectionOutputSchema.Type
>(({ input, client }) =>
	client.operations
		.invoke({
			packageId: PLUGIN_PACKAGE_ID,
			submittedAt: input.submittedAt,
			idempotencyKey: input.submissionId,
			slug: workoutTimeCorrectionOperationSlug,
			output: WorkoutTimeCorrectionOutputSchema,
			inputSchema: WorkoutTimeCorrectionInputSchema,
			input: { ...input.input, submittedAt: input.submittedAt, submissionId: input.submissionId },
		})
		.pipe(Effect.map(({ output }) => output)),
);
const timeSourceQuery = () =>
	createRyotQuery(({ input, client }: { readonly input: string; readonly client: RyotClient }) =>
		Effect.gen(function* () {
			const entity = yield* client.data.query(
				workoutEditorEntityRecipe({ reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }),
				{ entityId: input, kind: "workout" },
			);
			if (entity === null) {
				return null;
			}
			const properties = yield* Schema.decodeUnknownEffect(WorkoutPropertiesSchema)(
				entity.properties,
			).pipe(Effect.mapError(() => new RyotClientError({ reason: "malformed-result" })));
			return { entity, properties };
		}),
	);

export function AdjustWorkoutTime(props: {
	readonly entityId: string;
	readonly onClose: () => void;
}) {
	const text = useFitnessMessages();
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
		<Dialog
			onClose={props.onClose}
			title={text("client.adjust.title")}
			closeLabel={text("client.adjust.close")}
		>
			{source.isError ? (
				<Notice
					tone="danger"
					action={
						<Button size="sm" variant="secondary" onClick={source.refetch}>
							{text("client.adjust.retry")}
						</Button>
					}
				>
					{text("client.adjust.load-failed")}
				</Notice>
			) : (
				<p role="status" className="text-text-muted">
					{source.data === null ? text("client.workout.missing") : text("client.adjust.loading")}
				</p>
			)}
		</Dialog>
	);
}

function TimeForm(props: {
	readonly onClose: () => void;
	readonly properties: WorkoutProperties;
	readonly entity: WorkoutEditorBaseline["entity"];
}) {
	const text = useFitnessMessages();
	const { entity, onClose, properties } = props;
	const start = useDateTimeInput(properties.startedAt);
	const end = useDateTimeInput(properties.endedAt);
	const [submitted, setSubmitted] = useState(false);
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
		setSubmitted(true);
		if (start.resolution.iso === null || (end.value !== "" && end.resolution.iso === null)) {
			return;
		}
		const startedAt = start.resolution.iso;
		const endedAt = end.value === "" ? undefined : (end.resolution.iso ?? undefined);
		if (
			(endedAt !== undefined && Date.parse(endedAt) < Date.parse(startedAt)) ||
			(intent === "set" &&
				(seconds.trim() === "" || !Number.isSafeInteger(Number(seconds)) || Number(seconds) < 0))
		) {
			setMessage(text("client.adjust.invalid"));
			return;
		}
		let activeDuration: Correction["activeDuration"] = { kind: "preserve" };
		if (intent === "set") {
			activeDuration = { kind: "set", seconds: Number(seconds) };
		}
		if (intent === "clear") {
			activeDuration = { kind: "clear" };
		}
		const conflictToken = encodeWorkoutEditorBaseline({ entity, sets: [] });
		if (Result.isFailure(conflictToken)) {
			setMessage(text("client.adjust.unprepared"));
			return;
		}
		save.submit({
			endedAt,
			startedAt,
			activeDuration,
			entityId: entity.id,
			conflictToken: conflictToken.success,
		});
	};
	const conflicted =
		save.error instanceof RyotClientError && save.error.reason === "changes-conflict";
	let submitLabel = text("client.adjust.save");
	if (save.status === "retained") {
		submitLabel = text("client.adjust.retry-correction");
	}
	if (save.isPending) {
		submitLabel = text("common.status.saving");
	}
	return (
		<Dialog
			onClose={onClose}
			dismissible={!save.isPending}
			title={text("client.adjust.title")}
			closeLabel={text("client.adjust.close")}
			description={text("client.adjust.description")}
			footer={
				<Button
					onClick={save.status === "retained" ? save.retry : submit}
					disabled={save.isPending || conflicted || save.data?.kind === "invalid"}
				>
					{submitLabel}
				</Button>
			}
		>
			<div className="grid gap-4">
				<fieldset
					className="grid min-w-0 gap-4 border-0 p-0"
					disabled={save.isPending || save.status === "retained" || conflicted}
				>
					<DateTimeField
						{...start}
						showError={submitted}
						label={text("client.adjust.start")}
						checkIcon={<AppIcon size={14} name="check" />}
						chevronIcon={<AppIcon size={14} name="chevron-down" />}
					/>
					<DateTimeField
						{...end}
						label={text("client.adjust.end")}
						showError={submitted && end.value !== ""}
						checkIcon={<AppIcon size={14} name="check" />}
						chevronIcon={<AppIcon size={14} name="chevron-down" />}
					/>
					<div className="grid gap-1.5">
						<span className="text-[13px] font-medium">
							{text("client.workout.active-duration")}
						</span>
						<SegmentedControl
							fill
							value={intent}
							onChange={setIntent}
							optionClassName="px-2"
							label={text("client.workout.active-duration")}
							options={[
								{
									value: "preserve",
									content: text("client.adjust.keep"),
									label: text("client.adjust.keep-label"),
								},
								{
									value: "set",
									content: text("client.adjust.set"),
									label: text("client.adjust.set-label"),
								},
								{
									value: "clear",
									content: text("client.adjust.clear"),
									label: text("client.adjust.clear-label"),
								},
							]}
						/>
					</div>
					{intent === "set" ? (
						<Field label={text("client.adjust.duration-seconds")}>
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
				{conflicted ? <Notice tone="danger">{text("client.adjust.conflict")}</Notice> : null}
				{save.error && !conflicted ? (
					<Notice tone="danger">{text("client.adjust.unconfirmed")}</Notice>
				) : null}
				{save.data?.kind === "invalid" ? (
					<Notice tone="danger">{text("client.adjust.rejected")}</Notice>
				) : null}
			</div>
		</Dialog>
	);
}
