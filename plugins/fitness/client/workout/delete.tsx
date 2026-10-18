import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import {
	createRyotMutation,
	useRyot,
	useRyotSubmission,
	type RyotSubmission,
} from "@ryot-app/plugin-client-sdk/react";
import { Button, Dialog, Notice } from "@ryot-app/plugin-ui-sdk";
import { useEffect } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import {
	WorkoutDeleteInputSchema,
	WorkoutDeleteOutputSchema,
	workoutDeleteOperationSlug,
} from "../../shared/workout-delete-operations";

const deleteWorkout = createRyotMutation<
	RyotSubmission<string>,
	typeof WorkoutDeleteOutputSchema.Type
>(({ input, client }) =>
	Schema.decodeEffect(WorkoutDeleteInputSchema)({
		entityId: input.input,
		submittedAt: input.submittedAt,
		submissionId: input.submissionId,
	}).pipe(
		Effect.mapError(() => new RyotClientError("invalid-input")),
		Effect.flatMap((payload) =>
			client.operations.invoke({
				input: payload,
				refreshOnSuccess: false,
				packageId: PLUGIN_PACKAGE_ID,
				slug: workoutDeleteOperationSlug,
				output: WorkoutDeleteOutputSchema,
				inputSchema: WorkoutDeleteInputSchema,
			}),
		),
	),
);

export function DeleteWorkout(props: {
	readonly entityId: string;
	readonly name: string;
	readonly onClose: () => void;
}) {
	const client = useRyot();
	const deletion = useRyotSubmission(deleteWorkout);
	useEffect(() => {
		if (deletion.data) {
			client.navigation.replace({
				kind: "saved-view",
				reference: {
					kind: "plugin",
					slug: "all-workouts",
					pluginId: client.pluginIdentity(PLUGIN_PACKAGE_ID).pluginId,
				},
			});
			client.mutationCompleted.hint();
		}
	}, [client, deletion.data]);
	return (
		<Dialog
			closeIcon={null}
			title="Delete workout?"
			onClose={props.onClose}
			closeLabel="Cancel deletion"
			dismissible={!deletion.isPending}
			footer={
				<>
					<Button variant="secondary" onClick={props.onClose} disabled={deletion.isPending}>
						Cancel
					</Button>
					<Button
						variant="danger"
						loading={deletion.isPending}
						onClick={
							deletion.status === "retained"
								? deletion.retry
								: () => deletion.submit(props.entityId)
						}
					>
						{deletion.status === "retained" ? "Retry deletion" : "Delete workout"}
					</Button>
				</>
			}
		>
			<p>
				Permanently delete “{props.name}” and its sets? This cannot be undone. Exercises, templates,
				other workouts, and separately logged measurements will stay.
			</p>
			{deletion.error ? (
				<Notice tone="danger">
					Deletion could not be confirmed. Retry to confirm the result safely.
				</Notice>
			) : null}
		</Dialog>
	);
}
