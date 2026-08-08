import { useHotkey } from "@tanstack/react-hotkeys";
import clsx from "clsx";
import { Slot } from "expo-router";
import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";

import { CustomizeSidebarPanel } from "./customize/customize-sidebar-panel";
import type { CustomizeSection } from "./customize/customize-state";
import type { NavigationItem } from "./navigation-data";
import { Sidebar } from "./sidebar";
import { useWorkspaceDrawer, WorkspaceDrawer } from "./workspace-drawer";
import { WorkspaceNavigationLayout } from "./workspace-navigation-layout";
import { WorkspaceSwitcher } from "./workspace-picker";

function WorkspaceShellContent() {
	const { navigation } = useWorkspaceDrawer();
	const [customize, setCustomize] = useState<{ section?: CustomizeSection } | null>(null);
	const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
	const [isCommandCenterOpen, setIsCommandCenterOpen] = useState(false);

	function navigate(item: NavigationItem) {
		setIsWorkspaceOpen(false);
		navigation.navigate(item);
	}

	function selectWorkspace(slug: string) {
		setIsWorkspaceOpen(false);
		navigation.selectWorkspace(slug);
	}

	function openSettings() {
		setIsWorkspaceOpen(false);
		navigation.openSettings();
	}

	function openCustomize(section?: CustomizeSection) {
		setIsWorkspaceOpen(false);
		setCustomize({ section });
	}

	useHotkey("Meta+K", () => setIsCommandCenterOpen(true), { stopPropagation: false });
	useHotkey("Meta+,", openSettings, { stopPropagation: false });

	return (
		<View className="flex-1">
			<View className="flex-1 flex-row">
				<View
					className={clsx(
						"hidden flex-col border-r border-border bg-surface md:flex",
						customize === null ? "w-66" : "w-100",
					)}
				>
					{customize === null ? (
						<Sidebar
							className="flex-1"
							onNavigate={navigate}
							items={navigation.items}
							onEditSection={openCustomize}
							onOpenSettings={openSettings}
							key={navigation.workspace.slug}
							activeKey={navigation.activeKey}
							workspace={navigation.workspace}
							accountName={navigation.accountName}
							accountEmail={navigation.accountEmail}
							accountImage={navigation.accountImage}
							onWorkspaceOpen={() => setIsWorkspaceOpen(true)}
							onOpenSearch={() => setIsCommandCenterOpen(true)}
						/>
					) : (
						<CustomizeSidebarPanel
							data={navigation.data}
							initialSection={customize.section}
							onClose={() => setCustomize(null)}
							workspaceSlug={navigation.workspace.slug}
						/>
					)}
				</View>
				<View className="relative flex-1">
					<Slot />
					{customize !== null && (
						<View pointerEvents="auto" className="absolute inset-0 z-30 bg-overlay" />
					)}
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
					<View className="absolute left-3.5 top-21.5 z-50 hidden w-[320px] flex-col gap-2.5 rounded-[14px] border border-border bg-surface p-3 shadow-card md:flex">
						<Text className="font-mono text-[10px] font-normal uppercase tracking-[1.1px] text-text-subtle">
							Workspaces
						</Text>
						<WorkspaceSwitcher
							data={navigation.data}
							onSelect={selectWorkspace}
							currentWorkspaceSlug={navigation.workspace.slug}
						/>
						<Pressable
							accessibilityRole="button"
							onPress={() => openCustomize()}
							accessibilityLabel="Customize sidebar"
							className="flex-row items-center gap-2.5 rounded-lg border border-border bg-surface-2 px-3 py-2.5"
						>
							<AppIcon className="text-text-muted" name="sliders-horizontal" size={16} />
							<Text className="font-ui-medium text-sm text-text">Customize sidebar…</Text>
						</Pressable>
					</View>
				</>
			)}
			<Modal
				transparent
				animationType="fade"
				visible={isCommandCenterOpen}
				onRequestClose={() => setIsCommandCenterOpen(false)}
			>
				<View accessibilityViewIsModal className="flex-1 items-center justify-center p-4">
					<Pressable
						accessibilityRole="button"
						className="absolute inset-0 bg-overlay"
						accessibilityLabel="Close command center"
						onPress={() => setIsCommandCenterOpen(false)}
					/>
					<View className="w-full max-w-xl rounded-xl border border-border bg-surface p-5 shadow-card">
						<Text className="font-ui-semibold text-lg text-text">Command center</Text>
						<Text className="mt-2 font-ui text-sm text-text-muted">
							Command center content goes here.
						</Text>
					</View>
				</View>
			</Modal>
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
