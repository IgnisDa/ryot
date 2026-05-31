import clsx from "clsx";
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
					<View className="absolute left-3.5 top-19.5 z-50 hidden w-[320px] flex-col gap-2.5 rounded-[14px] border border-border bg-surface p-3 shadow-card md:flex">
						<Text className="font-mono text-[10px] font-normal uppercase tracking-[1.1px] text-text-subtle">
							Workspaces
						</Text>
						<View className="flex-row items-center gap-2 rounded-lg border border-border-strong bg-transparent px-2.5 py-2">
							<NavigationIcon className="text-text-muted" name="search" size={14} />
							<Text className="font-ui text-xs text-text-muted">Find workspace</Text>
						</View>
						<View className="w-full gap-2">
							{navigation.data.workspaces.map((item) => {
								const workspaceItems = getNavigationItems({
									data: navigation.data,
									workspaceSlug: item.slug,
								});
								const isCurrent = item.slug === navigation.workspace.slug;
								return (
									<Pressable
										key={item.slug}
										accessibilityRole="button"
										onPress={() => selectWorkspace(item.slug)}
										accessibilityLabel={`Switch to ${item.name} workspace`}
										className={clsx(
											"w-full flex-row items-center gap-3 rounded-xl border px-3 py-3",
											isCurrent ? "border-accent bg-accent-soft" : "border-border bg-surface",
										)}
									>
										<View
											className={clsx(
												"h-9 w-9 items-center justify-center rounded-[10px]",
												isCurrent ? "bg-accent" : "bg-surface-2",
											)}
										>
											<NavigationIcon
												size={18}
												name={item.icon}
												className={clsx(isCurrent ? "text-accent-ink" : "text-text")}
											/>
										</View>
										<View className="flex-1">
											<Text className="font-ui text-[15px] text-text">{item.name}</Text>
											<Text className="font-ui text-xs text-text-muted">
												{getWorkspacePickerSummary(workspaceItems)}
											</Text>
										</View>
										<NavigationIcon
											size={16}
											name={isCurrent ? "circle-check" : "chevron-right"}
											className={clsx(isCurrent ? "text-accent-text" : "text-text-subtle")}
										/>
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
