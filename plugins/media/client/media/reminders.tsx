import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotMutation, useRyotMutation } from "@ryot-app/plugin-client-sdk/react";
import { Button } from "@ryot-app/plugin-ui-sdk";

const manageReminders = createRyotMutation<
	{ readonly entityId: string; readonly parentEntityId?: string },
	void
>(({ input, client }) => client.screens.manageReminders(input).pipe(Effect.asVoid));

export function MediaRemindersControl(props: {
	readonly entityId: string;
	readonly parentEntityId?: string;
}) {
	const mutation = useRyotMutation(manageReminders);
	return (
		<>
			<Button
				variant="secondary"
				disabled={mutation.isPending}
				onClick={() =>
					mutation.mutate({
						entityId: props.entityId,
						...(props.parentEntityId === undefined ? {} : { parentEntityId: props.parentEntityId }),
					})
				}
			>
				Reminders
			</Button>
			{mutation.error === null ? null : (
				<span role="alert" className="text-xs text-danger">
					Unable to open reminders. Try again.
				</span>
			)}
		</>
	);
}
