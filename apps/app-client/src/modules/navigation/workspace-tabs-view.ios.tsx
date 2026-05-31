import { Host, RNHostView, TabView, VStack } from "@expo/ui/swift-ui";
import { frame, ignoreSafeArea, tabViewStyle } from "@expo/ui/swift-ui/modifiers";
import { startTransition } from "react";
import { View } from "react-native";

import { getIosNativeTabIcon } from "./native-tab-icons";
import type { WorkspaceTabsViewProps } from "./workspace-tabs-view";

export function WorkspaceTabsView(props: WorkspaceTabsViewProps) {
	return (
		<Host style={{ flex: 1 }}>
			<TabView
				selection={props.selectedKey}
				modifiers={[tabViewStyle({ type: "sidebarAdaptable" })]}
				onSelectionChange={(key) => {
					startTransition(() => props.onSelect(key));
				}}
			>
				{props.tabs.map((tab) => (
					<TabView.Tab
						key={tab.key}
						value={tab.key}
						label={tab.label}
						systemImage={getIosNativeTabIcon(tab.icon)}
					>
						<VStack
							modifiers={[
								frame({ maxWidth: Infinity, maxHeight: Infinity }),
								ignoreSafeArea({ regions: "container", edges: "vertical" }),
							]}
						>
							<RNHostView>
								<View className="flex-1 bg-bg">
									{tab.key === props.selectedKey ? props.children : null}
								</View>
							</RNHostView>
						</VStack>
					</TabView.Tab>
				))}
			</TabView>
		</Host>
	);
}
