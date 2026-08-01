import { Stack } from "expo-router";

import { WorkspaceDrawer } from "./workspace-drawer";
import { WorkspaceNavigationLayout } from "./workspace-navigation-layout";

export function WorkspaceDrawerLayout() {
	return (
		<WorkspaceNavigationLayout>
			{(navigation) => (
				<WorkspaceDrawer navigation={navigation}>
					<Stack screenOptions={{ headerShown: false }}>
						<Stack.Screen name="index" options={{ gestureEnabled: false }} />
					</Stack>
				</WorkspaceDrawer>
			)}
		</WorkspaceNavigationLayout>
	);
}
