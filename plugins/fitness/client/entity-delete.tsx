import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import {
	createRyotMutation,
	type RyotSubmission,
	useRyot,
	useRyotSubmission,
} from "@ryot-app/plugin-client-sdk/react";
import { Button, Dialog, Notice } from "@ryot-app/plugin-ui-sdk";
import { useEffect } from "react";

import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";
import {
	WorkoutDeleteInputSchema,
	workoutDeleteOperationSlug,
	WorkoutDeleteOutputSchema,
	workoutTemplateDeleteOperationSlug,
} from "../shared/workout-delete-operations";

const entityKinds = {
	template: {
		noun: "template",
		savedViewSlug: "all-workout-templates",
		operationSlug: workoutTemplateDeleteOperationSlug,
		description: (name: string) =>
			`Permanently delete “${name}”? This cannot be undone. Workouts started from this template and its exercises will stay.`,
	},
	workout: {
		noun: "workout",
		savedViewSlug: "all-workouts",
		operationSlug: workoutDeleteOperationSlug,
		description: (name: string) =>
			`Permanently delete “${name}” and its sets? This cannot be undone. Exercises, templates, other workouts, and separately logged measurements will stay.`,
	},
};

type DeleteInput = { readonly entityId: string; readonly kind: keyof typeof entityKinds };

const deleteEntity = createRyotMutation<
	RyotSubmission<DeleteInput>,
	typeof WorkoutDeleteOutputSchema.Type
>(({ input, client }) =>
	Schema.decodeEffect(WorkoutDeleteInputSchema)({
		entityId: input.input.entityId,
		submittedAt: input.submittedAt,
		submissionId: input.submissionId,
	}).pipe(
		Effect.mapError(() => new RyotClientError("invalid-input")),
		Effect.flatMap((payload) =>
			client.operations.invoke({
				input: payload,
				refreshOnSuccess: false,
				packageId: PLUGIN_PACKAGE_ID,
				output: WorkoutDeleteOutputSchema,
				inputSchema: WorkoutDeleteInputSchema,
				slug: entityKinds[input.input.kind].operationSlug,
			}),
		),
	),
);

export function DeleteFitnessEntity(
	props: DeleteInput & { readonly name: string; readonly onClose: () => void },
) {
	const client = useRyot();
	const deletion = useRyotSubmission(deleteEntity);
	const kind = entityKinds[props.kind];
	useEffect(() => {
		if (deletion.data) {
			client.navigation.replace({
				kind: "saved-view",
				reference: {
					kind: "plugin",
					slug: kind.savedViewSlug,
					pluginId: client.pluginIdentity(PLUGIN_PACKAGE_ID).pluginId,
				},
			});
			client.mutationCompleted.hint();
		}
	}, [client, deletion.data, kind.savedViewSlug]);
	return (
		<Dialog
			closeIcon={null}
			onClose={props.onClose}
			closeLabel="Cancel deletion"
			title={`Delete ${kind.noun}?`}
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
								: () => deletion.submit({ kind: props.kind, entityId: props.entityId })
						}
					>
						{deletion.status === "retained" ? "Retry deletion" : `Delete ${kind.noun}`}
					</Button>
				</>
			}
		>
			<p>{kind.description(props.name)}</p>
			{deletion.error ? (
				<Notice tone="danger">
					Deletion could not be confirmed. Retry to confirm the result safely.
				</Notice>
			) : null}
		</Dialog>
	);
}
