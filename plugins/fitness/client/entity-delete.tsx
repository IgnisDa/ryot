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
import { useFitnessMessages } from "./messages";

const entityKinds = {
	workout: { savedViewSlug: "all-workouts", operationSlug: workoutDeleteOperationSlug },
	template: {
		savedViewSlug: "all-workout-templates",
		operationSlug: workoutTemplateDeleteOperationSlug,
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
		Effect.mapError(() => new RyotClientError({ reason: "invalid-input" })),
		Effect.flatMap((payload) =>
			client.operations.invoke({
				input: payload,
				refreshOnSuccess: false,
				packageId: PLUGIN_PACKAGE_ID,
				submittedAt: input.submittedAt,
				output: WorkoutDeleteOutputSchema,
				idempotencyKey: input.submissionId,
				inputSchema: WorkoutDeleteInputSchema,
				slug: entityKinds[input.input.kind].operationSlug,
			}),
		),
	),
);

export function DeleteFitnessEntity(
	props: DeleteInput & { readonly name: string; readonly onClose: () => void },
) {
	const text = useFitnessMessages();
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
			kind="alert"
			closeIcon={null}
			onClose={props.onClose}
			dismissible={!deletion.isPending}
			closeLabel={text("client.delete.cancel")}
			title={text("client.delete.title", { kind: props.kind })}
			footer={
				<>
					<Button variant="secondary" onClick={props.onClose} disabled={deletion.isPending}>
						{text("common.action.cancel")}
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
						{deletion.status === "retained"
							? text("client.delete.retry")
							: text("client.delete.action", { kind: props.kind })}
					</Button>
				</>
			}
		>
			<p>{text("client.delete.description", { kind: props.kind, name: props.name })}</p>
			{deletion.error ? <Notice tone="danger">{text("client.delete.unconfirmed")}</Notice> : null}
		</Dialog>
	);
}
