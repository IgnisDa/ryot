import type { ReactElement } from "react";

import type { ReadyWorkspaceNavigation } from "./use-workspace-navigation";
import type { WorkspaceTab } from "./workspace-tabs";

export type WorkspaceTabsViewProps = {
	selectedKey: string;
	children: ReactElement;
	tabs: readonly WorkspaceTab[];
	onSelect: (key: string) => void;
	navigation: ReadyWorkspaceNavigation;
};

export function WorkspaceTabsView(props: WorkspaceTabsViewProps) {
	return props.children;
}
