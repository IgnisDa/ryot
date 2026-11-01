import { Button, MenuButton, type MenuItem } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";

export function HeaderActionsMenu(props: {
	readonly label: string;
	readonly items: ReadonlyArray<MenuItem>;
}) {
	return (
		<MenuButton
			label={props.label}
			items={props.items}
			renderTrigger={(trigger) => (
				<Button {...trigger} variant="secondary" aria-label={props.label}>
					<AppIcon size={18} name="more-horizontal" />
				</Button>
			)}
		/>
	);
}
