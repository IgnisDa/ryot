import { Modal } from "@mantine/core";
import {
	useFacetSidebarActions,
	useFacetSidebarState,
} from "../sidebar-context";
import { FacetForm } from "./facet-form";

export function FacetModal() {
	const state = useFacetSidebarState();
	const actions = useFacetSidebarActions();
	const isCreateMode = state.activeFacet === undefined;

	return (
		<Modal
			centered
			size="lg"
			opened={state.modalOpened}
			onClose={actions.closeModal}
			overlayProps={{ backgroundOpacity: 0.55, blur: 3 }}
			title={isCreateMode ? "Create facet" : "Edit facet"}
		>
			<FacetForm key={state.activeFacet?.id ?? "create"} />
		</Modal>
	);
}
