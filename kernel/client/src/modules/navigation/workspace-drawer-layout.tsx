import { Stack } from "expo-router";

import { WorkspaceDrawer } from "./workspace-drawer";

export function WorkspaceDrawerLayout() {
	return (
		<WorkspaceDrawer>
			<Stack screenOptions={{ headerShown: false }}>
				<Stack.Screen name="index" options={{ gestureEnabled: false }} />
			</Stack>
		</WorkspaceDrawer>
	);
}
