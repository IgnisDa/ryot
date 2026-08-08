import { Slot } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { AppIcon as NavigationIcon } from "@/modules/icons";

import type { NavigationItem } from "./navigation-data";
import { Sidebar } from "./sidebar";
import { useWorkspaceDrawer, WorkspaceDrawer } from "./workspace-drawer";
import { WorkspaceNavigationLayout } from "./workspace-navigation-layout";
import { WorkspacePickerList } from "./workspace-picker";

function WorkspaceShellContent() {
	const { navigation } = useWorkspaceDrawer();
	const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);

	function navigate(item: NavigationItem) {
		setIsWorkspaceOpen(false);
		navigation.navigate(item);
	}

	function selectWorkspace(slug: string) {
		setIsWorkspaceOpen(false);
		navigation.selectWorkspace(slug);
	}

	return (
		<View className="flex-1">
			<View className="flex-1 flex-row">
				<Sidebar
					showSearch
					onNavigate={navigate}
					items={navigation.items}
					key={navigation.workspace.slug}
					activeKey={navigation.activeKey}
					workspace={navigation.workspace}
					accountName={navigation.accountName}
					accountEmail={navigation.accountEmail}
					accountImage={navigation.accountImage}
					onWorkspaceOpen={() => setIsWorkspaceOpen(true)}
					className="hidden w-66 flex-col border-r border-border bg-surface md:flex"
				/>
				<View className="flex-1">
					<Slot />
				</View>
			</View>
			{isWorkspaceOpen && (
				<>
					<Pressable
						accessibilityRole="button"
						className="absolute inset-0 z-30 bg-overlay"
						accessibilityLabel="Close navigation overlay"
						onPress={() => setIsWorkspaceOpen(false)}
					/>
					<View className="absolute left-3.5 top-19.5 z-50 hidden w-[320px] flex-col gap-2.5 rounded-[14px] border border-border bg-surface p-3 shadow-card md:flex">
						<Text className="font-mono text-[10px] font-normal uppercase tracking-[1.1px] text-text-subtle">
							Workspaces
						</Text>
						<View className="flex-row items-center gap-2 rounded-lg border border-border-strong bg-transparent px-2.5 py-2">
							<NavigationIcon className="text-text-muted" name="search" size={14} />
							<Text className="font-ui text-xs text-text-muted">Find workspace</Text>
						</View>
						<WorkspacePickerList
							variant="desktop"
							data={navigation.data}
							onSelect={selectWorkspace}
							currentWorkspaceSlug={navigation.workspace.slug}
						/>
					</View>
				</>
			)}
		</View>
	);
}

export function WorkspaceShell() {
	return (
		<WorkspaceNavigationLayout>
			{(navigation) => (
				<WorkspaceDrawer navigation={navigation}>
					<WorkspaceShellContent />
				</WorkspaceDrawer>
			)}
		</WorkspaceNavigationLayout>
	);
}
