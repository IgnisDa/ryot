import { Button, Stack, Text } from "@mantine/core";
import { Copy } from "lucide-react";
import type { AppSavedView } from "../model";

export function SavedViewDrawerContent(props: {
	view: AppSavedView;
	isCloning: boolean;
	onClone: () => void | Promise<void>;
}) {
	return (
		<Stack gap="md">
			<Text size="sm" c="dimmed">
				Saved views are read-only in the app right now. Advanced editing for
				expressions, filters, sorting, and computed fields is currently
				available only through direct payloads and config.
			</Text>
			{props.view.isBuiltin ? (
				<>
					<Text size="sm" c="dimmed">
						Built-in views stay read-only. Clone this view if you want a copy
						for separate management.
					</Text>
					<Button
						variant="light"
						loading={props.isCloning}
						leftSection={<Copy size={14} />}
						onClick={() => void props.onClone()}
					>
						Clone View
					</Button>
				</>
			) : null}
		</Stack>
	);
}
