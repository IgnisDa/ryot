import type { ReactElement } from "react";

import type { WorkspaceTab } from "./workspace-tabs";

export type WorkspaceTabsViewProps = {
	selectedKey: string;
	children: ReactElement;
	tabs: readonly WorkspaceTab[];
	onSelect: (key: string) => void;
};

export function WorkspaceTabsView(props: WorkspaceTabsViewProps) {
	return props.children;
}
