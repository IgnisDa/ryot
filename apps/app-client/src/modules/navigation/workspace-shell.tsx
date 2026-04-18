import { Slot } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { AppIcon as NavigationIcon } from "@/modules/icons";

import {
	getNavigationItems,
	getWorkspacePickerSummary,
	type NavigationItem,
} from "./navigation-data";
import { NavigationStatus } from "./navigation-status";
import { Sidebar } from "./sidebar";
import { useWorkspaceNavigation } from "./use-workspace-navigation";
import { useWorkspaceDrawer, WorkspaceDrawer } from "./workspace-drawer";
import { WorkspaceScreenFrame } from "./workspace-screen-frame";

function WorkspaceShellContent() {
	const { navigation, openAccount } = useWorkspaceDrawer();
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
					onAccountOpen={openAccount}
					key={navigation.workspace.slug}
					activeKey={navigation.activeKey}
					workspace={navigation.workspace}
					accountName={navigation.accountName}
					accountEmail={navigation.accountEmail}
					onWorkspaceOpen={() => setIsWorkspaceOpen(true)}
					className="hidden w-66 flex-col border-r border-border bg-surface md:flex"
				/>
				<WorkspaceScreenFrame>
					<Slot />
				</WorkspaceScreenFrame>
			</View>
			{isWorkspaceOpen && (
				<>
					<Pressable
						accessibilityRole="button"
						className="absolute inset-0 z-30 bg-overlay"
						accessibilityLabel="Close navigation overlay"
						onPress={() => setIsWorkspaceOpen(false)}
					/>
					<View className="absolute left-69.5 top-19.5 z-50 hidden w-[320px] rounded-xl border border-border bg-surface p-3 shadow-card md:flex">
						<View className="flex-row items-center justify-between px-1 pb-2">
							<Text className="font-ui-semibold text-[10px] uppercase tracking-[1.6px] text-text-subtle">
								Workspaces
							</Text>
							<Pressable
								accessibilityRole="button"
								accessibilityLabel="Close workspace switcher"
								onPress={() => setIsWorkspaceOpen(false)}
							>
								<NavigationIcon className="text-text-muted" name="x" size={15} />
							</Pressable>
						</View>
						<View className="h-8 flex-row items-center gap-2 rounded-md border border-border bg-bg px-2">
							<NavigationIcon className="text-text-muted" name="search" size={14} />
							<Text className="font-ui text-xs text-text-muted">Find workspace</Text>
						</View>
						<View className="mt-2 gap-1">
							{navigation.data.workspaces.map((item) => {
								const workspaceItems = getNavigationItems({
									data: navigation.data,
									workspaceSlug: item.slug,
								});
								return (
									<Pressable
										key={item.slug}
										accessibilityRole="button"
										onPress={() => selectWorkspace(item.slug)}
										accessibilityLabel={`Switch to ${item.name} workspace`}
										className="flex-row items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2"
									>
										<View className="h-8 w-8 items-center justify-center rounded-md bg-accent-soft">
											<NavigationIcon className="text-accent-text" name={item.icon} size={15} />
										</View>
										<View className="flex-1">
											<Text className="font-ui-medium text-xs text-text">{item.name}</Text>
											<Text className="font-ui text-[10px] text-text-muted">
												{getWorkspacePickerSummary(workspaceItems)}
											</Text>
										</View>
										{item.slug === navigation.workspace.slug && (
											<NavigationIcon className="text-accent-text" name="check" size={15} />
										)}
									</Pressable>
								);
							})}
						</View>
					</View>
				</>
			)}
		</View>
	);
}

export function WorkspaceShell() {
	const navigation = useWorkspaceNavigation();

	if (navigation.status === "loading") {
		return <NavigationStatus title="Loading navigation..." />;
	}
	if (navigation.status === "error") {
		return <NavigationStatus title={navigation.title} detail={navigation.detail} />;
	}

	return (
		<WorkspaceDrawer navigation={navigation}>
			<WorkspaceShellContent />
		</WorkspaceDrawer>
	);
}
