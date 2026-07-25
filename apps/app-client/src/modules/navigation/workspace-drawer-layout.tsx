import { Stack } from "expo-router";
import type { ComponentProps } from "react";

import { NavigationStatus } from "./navigation-status";
import { useWorkspaceNavigation } from "./use-workspace-navigation";
import { WorkspaceDrawer } from "./workspace-drawer";
import { WorkspaceScreenFrame } from "./workspace-screen-frame";

type ScreenLayoutProps = Parameters<NonNullable<ComponentProps<typeof Stack>["screenLayout"]>>[0];

function renderWorkspaceScreen(props: ScreenLayoutProps) {
	return <WorkspaceScreenFrame>{props.children}</WorkspaceScreenFrame>;
}

export function WorkspaceDrawerLayout() {
	const navigation = useWorkspaceNavigation();

	if (navigation.status === "loading") {
		return <NavigationStatus title="Loading navigation..." />;
	}
	if (navigation.status === "error") {
		return <NavigationStatus title={navigation.title} detail={navigation.detail} />;
	}

	return (
		<WorkspaceDrawer navigation={navigation}>
			<Stack screenLayout={renderWorkspaceScreen} screenOptions={{ headerShown: false }} />
		</WorkspaceDrawer>
	);
}
