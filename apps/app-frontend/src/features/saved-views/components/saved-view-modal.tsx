import { Modal } from "@mantine/core";
import type { SidebarTracker } from "#/components/sidebar/Sidebar.types";
import type { SavedViewFormValues } from "../form";
import type { AppSavedView } from "../model";
import { SavedViewForm } from "./saved-view-form";

export function SavedViewModal(props: {
	opened: boolean;
	onClose: () => void;
	isSubmitting: boolean;
	trackers: SidebarTracker[];
	view: AppSavedView | undefined;
	onSubmit: (values: SavedViewFormValues) => Promise<void>;
}) {
	return (
		<Modal
			centered
			size="lg"
			opened={props.opened}
			onClose={props.onClose}
			title="Edit saved view"
			overlayProps={{ backgroundOpacity: 0.55, blur: 3 }}
		>
			{props.view && (
				<SavedViewForm
					view={props.view}
					key={props.view.id}
					onCancel={props.onClose}
					trackers={props.trackers}
					onSubmit={props.onSubmit}
					isSubmitting={props.isSubmitting}
				/>
			)}
		</Modal>
	);
}
