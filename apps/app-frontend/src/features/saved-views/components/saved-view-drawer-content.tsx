import { Button, Stack, Text } from "@mantine/core";
import { Copy } from "lucide-react";
import type { SavedViewExtendedFormValues } from "../form-extended";
import type { AppSavedView } from "../model";
import { SavedViewExtendedForm } from "./saved-view-extended-form";

export function SavedViewDrawerContent(props: {
	view: AppSavedView;
	isCloning: boolean;
	onCancel: () => void;
	isSubmitting: boolean;
	onClone: () => void | Promise<void>;
	onSubmit: (values: SavedViewExtendedFormValues) => Promise<void>;
}) {
	if (props.view.isBuiltin) {
		return (
			<Stack gap="md">
				<Text size="sm" c="dimmed">
					Built-in views cannot be edited. Clone this view to create a
					customizable copy.
				</Text>
				<Button
					variant="light"
					loading={props.isCloning}
					leftSection={<Copy size={14} />}
					onClick={() => void props.onClone()}
				>
					Clone View
				</Button>
			</Stack>
		);
	}

	return (
		<SavedViewExtendedForm
			view={props.view}
			onCancel={props.onCancel}
			onSubmit={props.onSubmit}
			isSubmitting={props.isSubmitting}
		/>
	);
}
