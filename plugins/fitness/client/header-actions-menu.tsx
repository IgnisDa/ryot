import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import type { Text } from "@ryot-app/plugin-client-sdk/react";
import { createRyotMutation, useRyotMutation } from "@ryot-app/plugin-client-sdk/react";
import { MenuButton, type MenuItem } from "@ryot-app/plugin-ui-sdk";

import { useFitnessMessages } from "./messages";

const manageReminders = createRyotMutation<{ readonly entityId: string }, void>(
	({ input, client }) => client.screens.manageReminders(input).pipe(Effect.asVoid),
);

export function HeaderActionsMenu(props: {
	readonly label: Text;
	readonly entityId: string;
	readonly items: ReadonlyArray<MenuItem>;
}) {
	const text = useFitnessMessages();
	const reminders = useRyotMutation(manageReminders);
	return (
		<>
			<MenuButton
				trigger="toolbar"
				label={props.label}
				items={[
					{
						key: "reminders",
						disabled: reminders.isPending,
						label: text("client.header.reminders"),
						onSelect: () => reminders.mutate({ entityId: props.entityId }),
					},
					...props.items,
				]}
			/>
			{reminders.error === null ? null : (
				<span role="alert" className="text-xs text-danger">
					{text("client.header.reminders-failed")}
				</span>
			)}
		</>
	);
}
