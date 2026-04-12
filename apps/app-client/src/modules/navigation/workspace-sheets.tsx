import type { NavigationData } from "@ryot/ryotql-recipes/navigation";

import { BottomSheet } from "@/modules/ui/bottom-sheet";

import { WorkspaceSwitcher } from "./workspace-picker";

export function WorkspaceSheet(props: {
	onClose: () => void;
	data: NavigationData;
	currentWorkspaceSlug: string;
	onSelect: (slug: string) => void;
}) {
	return (
		<BottomSheet
			title="Workspaces"
			snapPoints={[420]}
			onClose={props.onClose}
			description="Switch between workspaces."
		>
			<WorkspaceSwitcher
				data={props.data}
				onSelect={props.onSelect}
				currentWorkspaceSlug={props.currentWorkspaceSlug}
			/>
		</BottomSheet>
	);
}
