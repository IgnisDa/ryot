import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import {
	createRyotMutation,
	formatError,
	useRyot,
	useRyotMutation,
	useT,
} from "@ryot-app/plugin-client-sdk/react";
import { DestructiveConfirmation, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { useEffect, useRef, useState } from "react";

import type { ExerciseKind } from "../../shared/exercise-kinds";
import {
	ExerciseMergeInputSchema,
	exerciseMergeOperationSlug,
	ExerciseMergeOutputSchema,
} from "../../shared/exercise-merge-operations";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { type FitnessText, useExerciseLabels, useFitnessMessages } from "../messages";
import { ExercisePicker } from "../workout-editor/exercise-picker";
import type { PickerExercise } from "../workout-editor/picker-model";

type MergeOutput = typeof ExerciseMergeOutputSchema.Type;
type MergeFailure = Exclude<MergeOutput, { kind: "merged" }>["kind"];

const mergeMutation = createRyotMutation<
	{ readonly mergeFrom: string; readonly mergeInto: string },
	MergeOutput
>(({ input, client }) =>
	Schema.decodeEffect(ExerciseMergeInputSchema)(input).pipe(
		Effect.mapError(() => new RyotClientError({ reason: "invalid-input" })),
		Effect.flatMap((payload) =>
			client.operations
				.invoke({
					input: payload,
					packageId: PLUGIN_PACKAGE_ID,
					slug: exerciseMergeOperationSlug,
					output: ExerciseMergeOutputSchema,
					inputSchema: ExerciseMergeInputSchema,
				})
				.pipe(Effect.map(({ output }) => output)),
		),
	),
);

export const mergeBlockedReason = (text: FitnessText, draftKind: "workout" | "template") =>
	text("client.exercise.merge.blocked", { draft: draftKind });

export function MergeFailureMessage(props: { readonly failure: MergeFailure }) {
	const text = useFitnessMessages();
	return (
		<StatusMessage tone="error">
			{text("client.exercise.merge.failure", {
				failure: props.failure === "kind-mismatch" ? "kind_mismatch" : props.failure,
			})}
		</StatusMessage>
	);
}

export function ExerciseMergeFlow(props: {
	readonly name: string;
	readonly exerciseId: string;
	readonly kind: ExerciseKind;
	readonly onClose: () => void;
	readonly onFailed: (failure: MergeFailure) => void;
}) {
	const { kind, name, onClose, onFailed, exerciseId } = props;
	const t = useT();
	const text = useFitnessMessages();
	const labels = useExerciseLabels();
	const client = useRyot();
	const applied = useRef(false);
	const handled = useRef<MergeOutput>(undefined);
	const trigger = useRef<HTMLButtonElement>(null);
	const merge = useRyotMutation(mergeMutation);
	const [target, setTarget] = useState<PickerExercise>();
	const result = merge.data;
	useEffect(() => {
		if (result === undefined || handled.current === result) {
			return;
		}
		handled.current = result;
		if (result.kind === "merged") {
			client.navigation.replace({ kind: "entity", entityId: result.mergeInto });
			client.mutationCompleted.hint();
			return;
		}
		onFailed(result.kind);
		onClose();
	}, [client, onClose, onFailed, result]);
	if (target === undefined) {
		return (
			<ExercisePicker
				onClose={() => {
					if (!applied.current) {
						onClose();
					}
				}}
				onApply={([selected]) => {
					applied.current = true;
					setTarget(selected);
				}}
				replacement={{
					kind,
					name,
					excludeIds: [exerciseId],
					applyLabel: text("client.exercise.merge.apply"),
					title: text("client.exercise.merge.title", { name }),
					description: text("client.exercise.merge.picker-description", {
						kind: labels.kind(kind),
					}),
				}}
			/>
		);
	}
	return (
		<DestructiveConfirmation
			onClose={onClose}
			triggerRef={trigger}
			pending={merge.isPending}
			actionLabel={text("client.exercise.merge.action")}
			title={text("client.exercise.merge.confirm-title")}
			pendingLabel={text("client.exercise.merge.pending")}
			onConfirm={() => merge.mutate({ mergeInto: target.id, mergeFrom: exerciseId })}
			detail={text("client.exercise.merge.confirm-detail", { name, target: target.name })}
			errorMessage={
				merge.error === null
					? undefined
					: formatError(t, merge.error, text("client.exercise.merge.unfinished"))
			}
		/>
	);
}
