import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotMutation, useRyotMutation } from "@ryot-app/plugin-client-sdk/react";
import { Button, MenuButton, type MenuItem } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";

const manageReminders = createRyotMutation<{ readonly entityId: string }, void>(
	({ input, client }) => client.screens.manageReminders(input).pipe(Effect.asVoid),
);

export function HeaderActionsMenu(props: {
	readonly label: string;
	readonly entityId: string;
	readonly items: ReadonlyArray<MenuItem>;
}) {
	const reminders = useRyotMutation(manageReminders);
	return (
		<>
			<MenuButton
				label={props.label}
				renderTrigger={(trigger) => (
					<Button {...trigger} variant="secondary" aria-label={props.label}>
						<AppIcon size={18} name="more-horizontal" />
					</Button>
				)}
				items={[
					{
						key: "reminders",
						label: "Reminders",
						disabled: reminders.isPending,
						onSelect: () => reminders.mutate({ entityId: props.entityId }),
					},
					...props.items,
				]}
			/>
			{reminders.error === null ? null : (
				<span role="alert" className="text-xs text-danger">
					Unable to open reminders. Try again.
				</span>
			)}
		</>
	);
}
