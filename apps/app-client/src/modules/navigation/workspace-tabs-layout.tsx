import { Slot } from "expo-router";
import { useState } from "react";

import { MobileMoreSheet } from "./mobile-more-sheet";
import { NavigationStatus } from "./navigation-status";
import { useWorkspaceNavigation } from "./use-workspace-navigation";
import { getSelectedWorkspaceTabKey, getWorkspaceTabs } from "./workspace-tabs";
import { WorkspaceTabsView } from "./workspace-tabs-view";

export function WorkspaceTabsLayout() {
	const navigation = useWorkspaceNavigation();
	const [isMoreOpen, setIsMoreOpen] = useState(false);

	if (navigation.status === "loading") {
		return <NavigationStatus title="Loading navigation..." />;
	}
	if (navigation.status === "error") {
		return <NavigationStatus title={navigation.title} detail={navigation.detail} />;
	}

	const readyNavigation = navigation;
	const tabs = getWorkspaceTabs(navigation.items);
	const selectedKey = getSelectedWorkspaceTabKey(navigation.activeKey, tabs);

	function selectTab(key: string) {
		const tab = tabs.find((item) => item.key === key);
		if (!tab) {
			return;
		}
		if (tab.item) {
			readyNavigation.navigate(tab.item);
		} else {
			setIsMoreOpen(true);
		}
	}

	return (
		<>
			<WorkspaceTabsView
				tabs={tabs}
				onSelect={selectTab}
				navigation={navigation}
				selectedKey={selectedKey}
				key={navigation.workspace.slug}
			>
				<Slot />
			</WorkspaceTabsView>
			{isMoreOpen && (
				<MobileMoreSheet
					items={navigation.items}
					onClose={() => setIsMoreOpen(false)}
					onNavigate={(item) => {
						setIsMoreOpen(false);
						navigation.navigate(item);
					}}
				/>
			)}
		</>
	);
}
