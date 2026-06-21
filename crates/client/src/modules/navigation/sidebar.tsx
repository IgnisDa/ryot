import type { NavigationWorkspace } from "@ryot-app/ryotql-recipes/navigation";
import clsx from "clsx";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";

import { AppIcon as NavigationIcon } from "@/modules/icons";
import { AppAvatar } from "@/modules/ui/avatar";

import type { CustomizeSection } from "./customize/customize-state";
import { getWorkspaceSummary, type NavigationItem, type NavigationItems } from "./navigation-data";

const SHORTCUT_HINT_HIDDEN = Platform.OS === "web" ? null : "hidden";

function NavigationRow(props: { isActive: boolean; onPress: () => void; item: NavigationItem }) {
	return (
		<Pressable
			onPress={props.onPress}
			accessibilityRole="button"
			accessibilityLabel={props.item.name}
			className={clsx(
				"min-h-8 flex-row items-center gap-2.5 rounded-lg px-2.5",
				props.isActive && "bg-nav-indicator",
			)}
		>
			<NavigationIcon className="text-text-muted" name={props.item.icon} size={16} />
			<Text
				className={clsx(
					"flex-1 font-ui text-base",
					props.isActive ? "font-ui-medium text-text" : "text-text-muted",
				)}
			>
				{props.item.name}
			</Text>
			{props.item.kind !== "home" && (
				<NavigationIcon className="text-text-subtle" name="chevron-right" size={15} />
			)}
		</Pressable>
	);
}

function SectionHeader(props: { title: string; count?: number; onEdit?: () => void }) {
	return (
		<View className="group flex-row items-center justify-between px-1">
			<View className="flex-row items-center gap-2">
				<Text className="font-ui-semibold text-xs uppercase tracking-[1.6px] text-text-subtle">
					{props.title}
				</Text>
				{props.count !== undefined && (
					<Text className="font-mono text-xs text-text-subtle">{props.count}</Text>
				)}
			</View>
			{props.onEdit && Platform.OS === "web" ? (
				<Pressable
					focusable
					onPress={props.onEdit}
					accessibilityRole="button"
					accessibilityLabel={`Edit ${props.title} section`}
					className={clsx(
						"rounded px-1.5 py-0.5",
						"opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
					)}
				>
					<Text className="font-ui-medium text-xs text-text-muted">Edit</Text>
				</Pressable>
			) : null}
		</View>
	);
}

export function EmptyNavigationSection(props: { message: string }) {
	return <Text className="px-2 py-1 font-ui text-xs text-text-subtle">{props.message}</Text>;
}

function WorkspaceTrigger(props: {
	summary: string;
	onPress: () => void;
	workspace: NavigationWorkspace;
}) {
	const workspace = props.workspace;
	return (
		<Pressable
			onPress={props.onPress}
			accessibilityRole="button"
			accessibilityLabel="Switch workspace"
			className="flex-row items-center gap-2.5 rounded-lg border border-border bg-surface px-2.5 py-2.5"
		>
			<View className="h-8 w-8 items-center justify-center rounded-md bg-accent-soft">
				<NavigationIcon className="text-accent-text" name={workspace.icon} size={16} />
			</View>
			<View className="min-w-0 flex-1">
				<Text className="font-ui-medium text-sm text-text">{workspace.name}</Text>
				<Text className="font-ui text-xs text-text-muted">{props.summary}</Text>
			</View>
			<NavigationIcon className="text-text-subtle" name="chevron-down" size={15} />
		</Pressable>
	);
}

export function Sidebar(props: {
	isPro: boolean;
	className: string;
	activeKey: string;
	accountName: string;
	accountEmail: string;
	items: NavigationItems;
	onOpenSettings: () => void;
	accountImage: string | null;
	onWorkspaceOpen: () => void;
	workspace: NavigationWorkspace;
	onOpenSearch?: (() => void) | undefined;
	onNavigate: (item: NavigationItem) => void;
	onEditSection?: ((section: CustomizeSection) => void) | undefined;
}) {
	const items = props.items;

	return (
		<View className={props.className}>
			<ScrollView
				className="flex-1"
				showsVerticalScrollIndicator={false}
				contentContainerClassName="gap-2.5 px-3 pb-5 pt-[18px]"
			>
				<WorkspaceTrigger
					workspace={props.workspace}
					onPress={props.onWorkspaceOpen}
					summary={getWorkspaceSummary(items)}
				/>
				<Pressable
					accessibilityRole="button"
					onPress={props.onOpenSearch}
					disabled={!props.onOpenSearch}
					accessibilityLabel="Open command center"
					accessibilityState={{ disabled: !props.onOpenSearch }}
					className="h-10 flex-row items-center gap-2.5 rounded-lg border border-border bg-bg px-2.5"
				>
					<NavigationIcon className="text-text-muted" name="search" size={16} />
					<Text className="min-w-0 flex-1 font-ui text-sm text-text-subtle">Search</Text>
					<View
						className={clsx("rounded border border-border px-1.5 py-0.5", SHORTCUT_HINT_HIDDEN)}
					>
						<Text className="font-mono text-xs text-text-subtle">⌘K</Text>
					</View>
				</Pressable>

				<View className="mt-2 gap-1.5">
					<SectionHeader
						title="Views"
						onEdit={props.onEditSection ? () => props.onEditSection?.("views") : undefined}
					/>
					<ScrollView
						nestedScrollEnabled
						className="max-h-83.5"
						showsVerticalScrollIndicator
						contentContainerClassName="gap-0.5"
					>
						{items.views.map((item) => (
							<NavigationRow
								item={item}
								key={item.slug}
								onPress={() => props.onNavigate(item)}
								isActive={
									item.kind === "home"
										? props.activeKey === "home"
										: props.activeKey === `view:${item.slug}`
								}
							/>
						))}
					</ScrollView>
				</View>

				<View className="my-2 h-px bg-border" />
				<View className="gap-1.5">
					<SectionHeader
						title="Saved Views"
						count={items.savedViews.length}
						onEdit={props.onEditSection ? () => props.onEditSection?.("savedViews") : undefined}
					/>
					<ScrollView
						nestedScrollEnabled
						className="max-h-52"
						showsVerticalScrollIndicator
						contentContainerClassName="gap-0.5"
					>
						{items.savedViews.length === 0 ? (
							<EmptyNavigationSection message="No saved views yet." />
						) : (
							items.savedViews.map((item) => (
								<NavigationRow
									item={item}
									key={item.slug}
									onPress={() => props.onNavigate(item)}
									isActive={props.activeKey === `view:${item.slug}`}
								/>
							))
						)}
					</ScrollView>
				</View>

				<View className="my-2 h-px bg-border" />
				<View className="gap-1.5">
					<SectionHeader title="Collections" count={items.collections.length} />
					<ScrollView
						nestedScrollEnabled
						className="max-h-52"
						showsVerticalScrollIndicator
						contentContainerClassName="gap-0.5"
					>
						{items.collections.length === 0 ? (
							<EmptyNavigationSection message="No collections yet." />
						) : (
							items.collections.map((item) => (
								<NavigationRow
									item={item}
									key={item.slug}
									onPress={() => props.onNavigate(item)}
									isActive={props.activeKey === `collection:${item.slug}`}
								/>
							))
						)}
					</ScrollView>
				</View>
			</ScrollView>
			<View className="border-t border-border px-3 py-3">
				<Pressable
					accessibilityRole="button"
					onPress={props.onOpenSettings}
					accessibilityLabel="Open settings"
					accessibilityState={{ selected: props.activeKey === "settings" }}
					className={clsx(
						"flex-row items-center gap-2.5 rounded-md px-2 py-2",
						props.activeKey === "settings" && "bg-nav-indicator",
					)}
				>
					<View className="relative">
						<AppAvatar
							url={props.accountImage}
							iconClassName="text-text-muted"
							className="h-8 w-8 rounded-full"
						/>
						{props.isPro && (
							<View
								accessibilityRole="image"
								accessibilityLabel="Ryot Pro"
								className="absolute -right-1 -top-1 h-4 w-4 items-center justify-center rounded-full border border-border bg-surface"
							>
								<NavigationIcon name="crown" size={9} className="text-accent-text" />
							</View>
						)}
					</View>
					<View className="flex-1">
						<Text className="font-ui-medium text-sm text-text">{props.accountName}</Text>
						<Text className="font-ui text-xs text-text-muted">{props.accountEmail}</Text>
					</View>
					<View className="p-1">
						<NavigationIcon className="text-text-subtle" name="settings" size={15} />
					</View>
				</Pressable>
			</View>
		</View>
	);
}
