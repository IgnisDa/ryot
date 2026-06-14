import type { ReactNode } from "react";

import { NavigationStatus } from "./navigation-status";
import { useWorkspaceNavigation, type ReadyWorkspaceNavigation } from "./use-workspace-navigation";

export function WorkspaceNavigationLayout(props: {
	children: (navigation: ReadyWorkspaceNavigation) => ReactNode;
}) {
	const navigation = useWorkspaceNavigation();

	if (navigation.status === "loading") {
		return <NavigationStatus title="Loading navigation..." />;
	}
	if (navigation.status === "error") {
		return <NavigationStatus title={navigation.title} detail={navigation.detail} />;
	}

	return props.children(navigation);
}
