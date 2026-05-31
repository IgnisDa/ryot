import { Host, Icon, NavigationBar, NavigationBarItem, Text } from "@expo/ui/jetpack-compose";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getAndroidNativeTabIcon } from "./native-tab-icons.android";
import type { WorkspaceTabsViewProps } from "./workspace-tabs-view";

export function WorkspaceTabsView(props: WorkspaceTabsViewProps) {
	const insets = useSafeAreaInsets();

	return (
		<View className="flex-1 bg-bg">
			{props.children}
			<View className="bg-surface" style={{ paddingBottom: insets.bottom }}>
				<Host matchContents style={{ width: "100%" }}>
					<NavigationBar>
						{props.tabs.map((tab) => (
							<NavigationBarItem
								key={tab.key}
								onClick={() => props.onSelect(tab.key)}
								selected={tab.key === props.selectedKey}
							>
								<NavigationBarItem.Icon>
									<Icon source={getAndroidNativeTabIcon(tab.icon)} size={24} />
								</NavigationBarItem.Icon>
								<NavigationBarItem.Label>
									<Text>{tab.label}</Text>
								</NavigationBarItem.Label>
							</NavigationBarItem>
						))}
					</NavigationBar>
				</Host>
			</View>
		</View>
	);
}
