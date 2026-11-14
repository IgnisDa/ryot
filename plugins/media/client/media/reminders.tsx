import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotMutation, useRyotMutation } from "@ryot-app/plugin-client-sdk/react";
import type { MenuItem } from "@ryot-app/plugin-ui-sdk";

const manageReminders = createRyotMutation<
	{ readonly entityId: string; readonly parentEntityId?: string },
	void
>(({ input, client }) => client.screens.manageReminders(input).pipe(Effect.asVoid));

export function useMediaReminders(props: {
	readonly entityId: string;
	readonly parentEntityId?: string;
}) {
	const mutation = useRyotMutation(manageReminders);
	const item: MenuItem = {
		key: "reminders",
		label: "Reminders",
		disabled: mutation.isPending,
		onSelect: () => mutation.mutate(props),
	};
	return {
		item,
		error:
			mutation.error === null ? null : (
				<span role="alert" className="text-xs text-danger">
					Unable to open reminders. Try again.
				</span>
			),
	};
}
