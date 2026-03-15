import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { NavigationWorkspace } from "@ryot/ryotql-recipes/navigation";
import clsx from "clsx";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { themeAtom } from "@/api/atoms";
import { AppIcon as NavigationIcon } from "@/modules/icons";

import { getWorkspaceSummary, type NavigationItem, type NavigationItems } from "./navigation-data";

const VIEWS_HEIGHT = 238;
const COLLECTIONS_HEIGHT = 148;
const SAVED_VIEWS_HEIGHT = 148;
const THEME_ORDER = ["light", "dark", "system"] as const;
const THEME_ICONS = { light: "sun", dark: "moon", system: "monitor" } as const;

function NavigationRow(props: {
	isActive: boolean;
	onPress: () => void;
	item: NavigationItem;
	reordering?: boolean;
	onReorder?: () => void;
}) {
	return (
		<Pressable
			onPress={props.onPress}
			accessibilityRole="button"
			accessibilityLabel={props.item.name}
			className={clsx(
				"min-h-7 flex-row items-center gap-2 rounded-md px-2",
				props.isActive && "bg-nav-indicator",
			)}
		>
			{props.reordering && (
				<Pressable
					className="-ml-1 p-1"
					onPress={props.onReorder}
					accessibilityRole="button"
					accessibilityLabel={`Move ${props.item.name} down`}
				>
					<NavigationIcon className="text-text-muted" name="grip-vertical" size={14} />
				</Pressable>
			)}
			<NavigationIcon className="text-text-muted" name={props.item.icon} size={15} />
			<Text
				className={clsx(
					"flex-1 font-ui text-base",
					props.isActive ? "font-ui-medium text-text" : "text-text-muted",
				)}
			>
				{props.item.name}
			</Text>
			{!props.reordering && props.item.kind !== "home" && (
				<NavigationIcon className="text-text-subtle" name="chevron-right" size={14} />
			)}
		</Pressable>
	);
}

function SectionHeader(props: { title: string; count?: number; action?: ReactNode }) {
	return (
		<View className="flex-row items-center justify-between px-1">
			<View className="flex-row items-center gap-2">
				<Text className="font-ui-semibold text-xs uppercase tracking-[1.6px] text-text-subtle">
					{props.title}
				</Text>
				{props.count !== undefined && (
					<Text className="font-mono text-xs text-text-subtle">{props.count}</Text>
				)}
			</View>
			{props.action}
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
			className="flex-row items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-2"
		>
			<View className="h-7 w-7 items-center justify-center rounded-md bg-accent-soft">
				<NavigationIcon className="text-accent-text" name={workspace.icon} size={15} />
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
	className: string;
	activeKey: string;
	showSearch: boolean;
	accountName: string;
	accountEmail: string;
	items: NavigationItems;
	onWorkspaceOpen: () => void;
	workspace: NavigationWorkspace;
	onNavigate: (item: NavigationItem) => void;
}) {
	const items = props.items;
	const theme = useAtomValue(themeAtom);
	const setTheme = useAtomSet(themeAtom);
	const [isReordering, setIsReordering] = useState(false);
	const [viewOrder, setViewOrder] = useState(items.views);

	function cycleTheme() {
		const currentIndex = THEME_ORDER.indexOf(theme);
		setTheme(THEME_ORDER[(currentIndex + 1) % THEME_ORDER.length]);
	}

	function moveView(index: number) {
		setViewOrder((current) => {
			if (index === current.length - 1) {
				return current;
			}
			const next = [...current];
			[next[index], next[index + 1]] = [next[index + 1], next[index]];
			return next;
		});
	}

	return (
		<View className={props.className}>
			<ScrollView
				className="flex-1"
				showsVerticalScrollIndicator={false}
				contentContainerClassName="gap-2 px-3 pb-5 pt-[18px]"
			>
				<WorkspaceTrigger
					workspace={props.workspace}
					onPress={props.onWorkspaceOpen}
					summary={getWorkspaceSummary(items)}
				/>
				{props.showSearch && (
					<View className="h-8 flex-row items-center gap-2 rounded-md border border-border bg-bg px-2.5">
						<NavigationIcon className="text-text-muted" name="search" size={15} />
						<TextInput
							placeholder="Search"
							returnKeyType="search"
							onSubmitEditing={() => undefined}
							accessibilityLabel="Search navigation"
							className="min-w-0 flex-1 py-0 font-ui text-xs text-text"
						/>
						<View className="rounded border border-border px-1.5 py-0.5">
							<Text className="font-mono text-xs text-text-subtle">⌘K</Text>
						</View>
					</View>
				)}

				<View className="mt-2 gap-1">
					<SectionHeader
						title="Views"
						action={
							<Pressable
								accessibilityRole="button"
								className="px-1 text-accent-text"
								onPress={() => setIsReordering((current) => !current)}
								accessibilityLabel={isReordering ? "Finish reordering views" : "Reorder views"}
							>
								<Text className="font-ui-medium text-xs text-accent-text">
									{isReordering ? "Done" : "Reorder"}
								</Text>
							</Pressable>
						}
					/>
					<ScrollView
						nestedScrollEnabled
						showsVerticalScrollIndicator
						style={{ height: VIEWS_HEIGHT }}
						contentContainerClassName="gap-0.5"
					>
						{viewOrder.map((item) => (
							<NavigationRow
								item={item}
								key={item.slug}
								reordering={isReordering}
								onPress={() => props.onNavigate(item)}
								onReorder={() => moveView(viewOrder.indexOf(item))}
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
				<View className="gap-1">
					<SectionHeader
						title="Collections"
						count={items.collections.length}
						action={<Text className="font-ui-medium text-xs text-accent-text">New</Text>}
					/>
					<ScrollView
						nestedScrollEnabled
						showsVerticalScrollIndicator
						contentContainerClassName="gap-0.5"
						style={{ height: COLLECTIONS_HEIGHT }}
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

				<View className="gap-1">
					<SectionHeader
						title="Saved Views"
						count={items.savedViews.length}
						action={<Text className="font-ui-medium text-xs text-accent-text">New</Text>}
					/>
					<ScrollView
						nestedScrollEnabled
						showsVerticalScrollIndicator
						contentContainerClassName="gap-0.5"
						style={{ height: SAVED_VIEWS_HEIGHT }}
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
			</ScrollView>
			<View className="border-t border-border px-3 py-3">
				<View className="flex-row items-center gap-2 rounded-md px-2 py-1.5">
					<View className="h-7 w-7 items-center justify-center rounded-full bg-surface-2">
						<NavigationIcon className="text-text-muted" name="user" size={15} />
					</View>
					<View className="flex-1">
						<Text className="font-ui-medium text-xs text-text">{props.accountName}</Text>
						<Text className="font-ui text-xs text-text-muted">{props.accountEmail}</Text>
					</View>
					<View className="flex-row gap-2">
						<Pressable
							accessibilityRole="button"
							onPress={cycleTheme}
							accessibilityLabel={`Switch to ${THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length]} theme`}
							className="p-1"
						>
							<NavigationIcon className="text-text-subtle" name={THEME_ICONS[theme]} size={15} />
						</Pressable>
						<Pressable
							accessibilityRole="button"
							accessibilityLabel="Settings"
							disabled
							className="p-1"
						>
							<NavigationIcon className="text-text-subtle" name="settings" size={15} />
						</Pressable>
					</View>
				</View>
			</View>
		</View>
	);
}
