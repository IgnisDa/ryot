import { Stack } from "expo-router";

import { NavigationStatus } from "./navigation-status";
import { useWorkspaceNavigation } from "./use-workspace-navigation";
import { WorkspaceDrawer } from "./workspace-drawer";

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
			<Stack screenOptions={{ headerShown: false }}>
				<Stack.Screen name="[workspace]/index" options={{ gestureEnabled: false }} />
			</Stack>
		</WorkspaceDrawer>
	);
}
