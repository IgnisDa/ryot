import { Modal } from "@mantine/core";

import { useTrackerSidebarActions, useTrackerSidebarState } from "../sidebar-context";
import { TrackerForm } from "./tracker-form";

export function TrackerModal() {
	const state = useTrackerSidebarState();
	const actions = useTrackerSidebarActions();
	const isCreateMode = state.activeTracker === undefined;

	return (
		<Modal
			centered
			size="lg"
			opened={state.modalOpened}
			onClose={actions.closeModal}
			overlayProps={{ backgroundOpacity: 0.55, blur: 3 }}
			title={isCreateMode ? "Create tracker" : "Edit tracker"}
		>
			<TrackerForm key={state.activeTracker?.id ?? "create"} />
		</Modal>
	);
}
