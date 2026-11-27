import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotMutation, useRyotMutation } from "@ryot-app/plugin-client-sdk/react";
import type { MenuItem } from "@ryot-app/plugin-ui-sdk";

import { useMediaMessages } from "../messages";

const manageReminders = createRyotMutation<
	{ readonly entityId: string; readonly parentEntityId?: string },
	void
>(({ input, client }) => client.screens.manageReminders(input).pipe(Effect.asVoid));

export function useMediaReminders(props: {
	readonly entityId: string;
	readonly parentEntityId?: string;
}) {
	const text = useMediaMessages();
	const mutation = useRyotMutation(manageReminders);
	const item: MenuItem = {
		key: "reminders",
		disabled: mutation.isPending,
		label: text("reminders.menu"),
		onSelect: () => mutation.mutate(props),
	};
	return {
		item,
		error:
			mutation.error === null ? null : (
				<span role="alert" className="text-xs text-danger">
					{text("reminders.failed")}
				</span>
			),
	};
}
