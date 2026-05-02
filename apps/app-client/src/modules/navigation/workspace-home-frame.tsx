import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { AppIcon as NavigationIcon } from "@/modules/icons";

import { useWorkspaceDrawer } from "./workspace-drawer";
import { WorkspaceScrollFrame } from "./workspace-scroll-frame";

const TOP_BAR_GAP = 12;
const TOP_BAR_HEIGHT = 57;

function WorkspaceTopBar(props: { onMenuOpen: () => void }) {
	return (
		<View className="flex-row items-center gap-3 py-2">
			<Pressable
				onPress={props.onMenuOpen}
				accessibilityRole="button"
				accessibilityLabel="Open navigation"
				className="h-10 w-10 items-center justify-center rounded-pill border border-border-strong bg-surface-2"
			>
				<NavigationIcon className="text-text-muted" name="menu" size={24} />
			</Pressable>
			<View className="h-10 flex-1 flex-row items-center gap-2 rounded-pill border border-border-strong bg-surface-2 px-3.5">
				<NavigationIcon className="text-text-muted" name="search" size={24} />
				<Text className="font-ui text-sm text-text-subtle">Search</Text>
			</View>
		</View>
	);
}

export function WorkspaceHomeFrame(props: { children: ReactNode }) {
	const drawer = useWorkspaceDrawer();

	return (
		<WorkspaceScrollFrame
			headerHeight={TOP_BAR_HEIGHT + TOP_BAR_GAP}
			headerClassName="border-b border-border px-4"
			header={<WorkspaceTopBar onMenuOpen={drawer.openDrawer} />}
		>
			{props.children}
		</WorkspaceScrollFrame>
	);
}
