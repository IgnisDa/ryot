import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotMutation, useRyot, useRyotMutation } from "@ryot-app/plugin-client-sdk/react";
import { DestructiveConfirmation, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { useEffect, useRef, useState } from "react";

import type { ExerciseKind } from "../../shared/exercise-kinds";
import {
	ExerciseMergeInputSchema,
	exerciseMergeOperationSlug,
	ExerciseMergeOutputSchema,
} from "../../shared/exercise-merge-operations";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { ExercisePicker } from "../workout-editor/exercise-picker";
import { labelForKind, type PickerExercise } from "../workout-editor/picker-model";

type MergeOutput = typeof ExerciseMergeOutputSchema.Type;
type MergeFailure = Exclude<MergeOutput, { kind: "merged" }>["kind"];

const mergeMutation = createRyotMutation<
	{ readonly mergeFrom: string; readonly mergeInto: string },
	MergeOutput
>(({ input, client }) =>
	Schema.decodeEffect(ExerciseMergeInputSchema)(input).pipe(
		Effect.mapError(() => new RyotClientError("invalid-input")),
		Effect.flatMap((payload) =>
			client.operations.invoke({
				input: payload,
				packageId: PLUGIN_PACKAGE_ID,
				slug: exerciseMergeOperationSlug,
				output: ExerciseMergeOutputSchema,
				inputSchema: ExerciseMergeInputSchema,
			}),
		),
	),
);

const failureMessages: Record<MergeFailure, string> = {
	same: "An exercise can't be merged into itself.",
	missing: "One of the exercises no longer exists.",
	"not-custom": "Only exercises you created can be merged into another exercise.",
	"kind-mismatch": "Exercises can only be merged into an exercise of the same kind.",
};

const mergeErrorMessage = (error: null | Error) => {
	if (error === null) {
		return undefined;
	}
	return error instanceof RyotClientError && error.reason === "operation-failed"
		? "The server declined this merge. Demo accounts can't merge exercises."
		: "The merge didn't finish. Try again to complete it.";
};

export const mergeBlockedReason = (draftKind: "workout" | "template") =>
	`Not available while this exercise is in your current ${draftKind}`;

export function MergeFailureMessage(props: { readonly failure: MergeFailure }) {
	return <StatusMessage tone="error">{failureMessages[props.failure]}</StatusMessage>;
}

export function ExerciseMergeFlow(props: {
	readonly name: string;
	readonly exerciseId: string;
	readonly kind: ExerciseKind;
	readonly onClose: () => void;
	readonly onFailed: (failure: MergeFailure) => void;
}) {
	const { kind, name, onClose, onFailed, exerciseId } = props;
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
					applyLabel: "Merge into",
					excludeIds: [exerciseId],
					title: `Merge ${name} into…`,
					description: `Only ${labelForKind(kind)} exercises can be merged into.`,
				}}
			/>
		);
	}
	return (
		<DestructiveConfirmation
			onClose={onClose}
			actionLabel="Merge"
			triggerRef={trigger}
			title="Merge exercise?"
			pendingLabel="Merging…"
			pending={merge.isPending}
			errorMessage={mergeErrorMessage(merge.error)}
			onConfirm={() => merge.mutate({ mergeInto: target.id, mergeFrom: exerciseId })}
			detail={`Merge ${name} into ${target.name}? Its history, notes and collection memberships move to ${target.name}. ${name} is removed from your library.`}
		/>
	);
}
