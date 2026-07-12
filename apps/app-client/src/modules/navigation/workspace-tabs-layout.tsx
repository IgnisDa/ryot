import { Stack } from "expo-router";
import { createContext, useContext, useState, type ComponentProps } from "react";

import { MobileMoreSheet } from "./mobile-more-sheet";
import { MobileWorkspaceFrame } from "./mobile-workspace-frame";
import { NavigationStatus } from "./navigation-status";
import { type ReadyWorkspaceNavigation, useWorkspaceNavigation } from "./use-workspace-navigation";
import { getSelectedWorkspaceTabKey, getWorkspaceTabs } from "./workspace-tabs";
import { WorkspaceTabsView } from "./workspace-tabs-view";

type ScreenLayoutProps = Parameters<NonNullable<ComponentProps<typeof Stack>["screenLayout"]>>[0];

const WorkspaceNavigationContext = createContext<ReadyWorkspaceNavigation | null>(null);

function WorkspaceScreenFrame(props: Pick<ScreenLayoutProps, "children">) {
	const navigation = useContext(WorkspaceNavigationContext);
	if (!navigation) {
		throw new Error("Workspace navigation is unavailable");
	}
	return <MobileWorkspaceFrame navigation={navigation}>{props.children}</MobileWorkspaceFrame>;
}

function renderWorkspaceScreen(props: ScreenLayoutProps) {
	return <WorkspaceScreenFrame>{props.children}</WorkspaceScreenFrame>;
}

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
				selectedKey={selectedKey}
				key={navigation.workspace.slug}
			>
				<WorkspaceNavigationContext.Provider value={readyNavigation}>
					<Stack screenLayout={renderWorkspaceScreen} screenOptions={{ headerShown: false }} />
				</WorkspaceNavigationContext.Provider>
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
