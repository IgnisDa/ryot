import { Text, View } from "react-native";

import { useWorkspaceDrawer } from "@/modules/navigation/workspace-drawer";
import { WorkspaceHomeFrame } from "@/modules/navigation/workspace-home-frame";

export default function AppHome() {
	const { navigation } = useWorkspaceDrawer();

	return (
		<WorkspaceHomeFrame>
			<View className="w-full max-w-3xl">
				<Text className="font-display-semibold text-3xl text-text">
					{navigation.workspace.name}
				</Text>
			</View>
		</WorkspaceHomeFrame>
	);
}
