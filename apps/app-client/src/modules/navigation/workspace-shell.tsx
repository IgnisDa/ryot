import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
	decodeNavigationResponse,
	type NavigationData,
	type NavigationWorkspace,
} from "@ryot/ryotql-recipes/navigation";
import clsx from "clsx";
import { Cause, Result } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { router, Slot, useGlobalSearchParams, usePathname } from "expo-router";
import { useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import Animated, {
	FadeInUp,
	FadeOutUp,
	LinearTransition,
	ReduceMotion,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { navigationAtom, themeAtom } from "@/api/atoms";
import { useAuthClient } from "@/modules/auth/client";
import { AppIcon as NavigationIcon } from "@/modules/icons";
import { useSetWorkspace, useWorkspace } from "@/modules/server/state";
import { BottomSheet } from "@/modules/ui/bottom-sheet";

import {
	getActiveNavigationKey,
	getCurrentWorkspace,
	getEnabledItems,
	getNavigationHref,
	getNavigationItems,
	getWorkspaceSummary,
	getWorkspacePickerSummary,
	type NavigationItem,
	type NavigationItems,
} from "./navigation-data";

const MOBILE_TOP_BAR_GAP = 12;
const MOBILE_TOP_BAR_HEIGHT = 57;
const MOBILE_TOP_BAR_ENTERING = FadeInUp.duration(200).reduceMotion(ReduceMotion.System);
const MOBILE_TOP_BAR_EXITING = FadeOutUp.duration(160).reduceMotion(ReduceMotion.System);
const MOBILE_TAB_BAR_LAYOUT = LinearTransition.duration(200).reduceMotion(ReduceMotion.System);
const SIDEBAR_VIEWS_HEIGHT = 238;
const SIDEBAR_COLLECTIONS_HEIGHT = 148;
const SIDEBAR_SAVED_VIEWS_HEIGHT = 148;

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
					onPress={props.onReorder}
					accessibilityRole="button"
					className="-ml-1 p-1"
					accessibilityLabel={`Move ${props.item.name} down`}
				>
					<NavigationIcon className="text-text-muted" name="grip-vertical" size={14} />
				</Pressable>
			)}
			<NavigationIcon className="text-text-muted" name={props.item.icon} size={15} />
			<Text
				className={clsx(
					"flex-1 font-ui text-sm",
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
				<Text className="font-ui-semibold text-[10px] uppercase tracking-[1.6px] text-text-subtle">
					{props.title}
				</Text>
				{props.count !== undefined && (
					<Text className="font-mono text-[10px] text-text-subtle">{props.count}</Text>
				)}
			</View>
			{props.action}
		</View>
	);
}

function EmptyNavigationSection(props: { message: string }) {
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
				<Text className="font-ui text-[11px] text-text-muted">{props.summary}</Text>
			</View>
			<NavigationIcon className="text-text-subtle" name="chevron-down" size={15} />
		</Pressable>
	);
}

function Sidebar(props: {
	activeKey: string;
	accountName: string;
	accountEmail: string;
	items: NavigationItems;
	onAccountOpen: () => void;
	onWorkspaceOpen: () => void;
	workspace: NavigationWorkspace;
	onNavigate: (item: NavigationItem) => void;
}) {
	const items = props.items;
	const [isReordering, setIsReordering] = useState(false);
	const [viewOrder, setViewOrder] = useState(items.views);

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
		<View className="relative hidden w-66 flex-col border-r border-border bg-surface md:flex">
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
						<Text className="font-mono text-[10px] text-text-subtle">⌘K</Text>
					</View>
				</View>

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
								<Text className="font-ui-medium text-[10px] text-accent-text">
									{isReordering ? "Done" : "Reorder"}
								</Text>
							</Pressable>
						}
					/>
					<ScrollView
						nestedScrollEnabled
						showsVerticalScrollIndicator
						style={{ height: SIDEBAR_VIEWS_HEIGHT }}
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
						style={{ height: SIDEBAR_COLLECTIONS_HEIGHT }}
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

				<View className="gap-1">
					<SectionHeader
						title="Saved Views"
						count={items.savedViews.length}
						action={<Text className="font-ui-medium text-xs text-accent-text">New</Text>}
					/>
					<ScrollView
						nestedScrollEnabled
						showsVerticalScrollIndicator
						style={{ height: SIDEBAR_SAVED_VIEWS_HEIGHT }}
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
			</ScrollView>
			<View className="border-t border-border px-3 py-3">
				<Pressable
					accessibilityRole="button"
					onPress={props.onAccountOpen}
					accessibilityLabel="Open account settings"
					className="flex-row items-center gap-2 rounded-md px-2 py-1.5"
				>
					<View className="h-7 w-7 items-center justify-center rounded-full bg-surface-2">
						<NavigationIcon className="text-text-muted" name="user" size={15} />
					</View>
					<View className="flex-1">
						<Text className="font-ui-medium text-xs text-text">{props.accountName}</Text>
						<Text className="font-ui text-[10px] text-text-muted">{props.accountEmail}</Text>
					</View>
					<View className="flex-row gap-2">
						<NavigationIcon className="text-text-subtle" name="moon" size={15} />
						<NavigationIcon className="text-text-subtle" name="settings" size={15} />
					</View>
				</Pressable>
			</View>
		</View>
	);
}

function MobileTopBar(props: {
	workspaceIcon: string;
	workspaceName: string;
	onWorkspaceOpen: () => void;
	onAccountOpen: () => void;
}) {
	return (
		<View className="flex-row items-center gap-3 py-2">
			<Pressable
				accessibilityRole="button"
				onPress={props.onAccountOpen}
				accessibilityLabel="Open account"
				className="h-10 w-10 items-center justify-center rounded-full bg-surface-2"
			>
				<NavigationIcon className="text-text-muted" name="user" size={24} />
			</Pressable>
			<View className="h-10 flex-1 flex-row items-center gap-2 rounded-pill border border-border-strong bg-surface-2 px-3.5">
				<NavigationIcon className="text-text-muted" name="search" size={24} />
				<Text className="font-ui text-sm text-text-subtle">Search</Text>
			</View>
			<Pressable
				accessibilityRole="button"
				onPress={props.onWorkspaceOpen}
				accessibilityLabel={`Switch workspace, current workspace ${props.workspaceName}`}
				className="h-10 w-10 items-center justify-center rounded-pill border border-border-strong bg-surface-2"
			>
				<NavigationIcon className="text-text-muted" name={props.workspaceIcon} size={24} />
			</Pressable>
		</View>
	);
}

function MobileTabBar(props: {
	activeKey: string;
	isCollapsed: boolean;
	onExpand: () => void;
	items: NavigationItems;
	onMoreOpen: () => void;
	onNavigate: (item: NavigationItem) => void;
}) {
	const items = props.items.views.slice(0, 4);
	const activeItem = items.find((item) =>
		item.kind === "home" ? props.activeKey === "home" : props.activeKey === `view:${item.slug}`,
	);
	const compactItem = activeItem ?? items[0];
	const visibleItems = props.isCollapsed && compactItem ? [compactItem] : items;

	return (
		<Animated.View
			layout={MOBILE_TAB_BAR_LAYOUT}
			className="flex-row items-center gap-1 overflow-hidden rounded-pill border border-nav-border bg-nav-surface p-1.5 shadow-card"
		>
			{visibleItems.map((item) => {
				const isActive = item === activeItem;
				return (
					<Animated.View key={item.slug} layout={MOBILE_TAB_BAR_LAYOUT} className="overflow-hidden">
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={props.isCollapsed ? "Expand navigation" : item.name}
							onPress={props.isCollapsed ? props.onExpand : () => props.onNavigate(item)}
							className={clsx(
								"h-10 flex-row items-center justify-center gap-1.5 rounded-pill",
								props.isCollapsed ? "w-10 px-0" : "px-3",
								isActive && !props.isCollapsed && "bg-nav-indicator",
							)}
						>
							<NavigationIcon
								name={item.icon}
								size={props.isCollapsed ? 26 : 24}
								className={clsx(
									(isActive || props.isCollapsed) && "text-accent-text",
									!isActive && !props.isCollapsed && "text-text-muted",
								)}
							/>
							{isActive && !props.isCollapsed && (
								<Text className="font-ui-medium text-xs text-accent-text">{item.name}</Text>
							)}
						</Pressable>
					</Animated.View>
				);
			})}
			{!props.isCollapsed && (
				<Pressable
					onPress={props.onMoreOpen}
					accessibilityRole="button"
					accessibilityLabel="Open more navigation"
					className="h-10 w-10 items-center justify-center rounded-pill"
				>
					<NavigationIcon className="text-text-muted" name="more-horizontal" size={24} />
				</Pressable>
			)}
		</Animated.View>
	);
}

function MobileWorkspaceSheet(props: {
	onClose: () => void;
	data: NavigationData;
	items: NavigationItems;
	currentWorkspaceSlug: string;
	onSelect: (slug: string) => void;
}) {
	return (
		<BottomSheet
			snapPoints={[465]}
			title="Workspaces"
			onClose={props.onClose}
			description="Switch between workspaces and review saved views."
		>
			<View className="gap-2">
				{props.data.workspaces.map((workspace) => {
					const items = getNavigationItems({ data: props.data, workspaceSlug: workspace.slug });
					const isCurrent = workspace.slug === props.currentWorkspaceSlug;
					return (
						<Pressable
							key={workspace.slug}
							accessibilityRole="button"
							onPress={() => props.onSelect(workspace.slug)}
							accessibilityLabel={`Switch to ${workspace.name} workspace`}
							className={clsx(
								"h-18 flex-row items-center gap-3.5 rounded-lg border px-3.5",
								isCurrent ? "border-accent-text bg-accent-soft" : "border-transparent bg-surface-2",
							)}
						>
							<View
								className={clsx(
									"h-11 w-11 items-center justify-center rounded-xl",
									isCurrent ? "bg-accent" : "bg-accent-soft",
								)}
							>
								<NavigationIcon
									size={21}
									name={workspace.icon}
									className={clsx(isCurrent ? "text-accent-ink" : "text-accent-text")}
								/>
							</View>
							<View className="min-w-0 flex-1 gap-0.5">
								<Text className="font-ui-semibold text-base text-text">{workspace.name}</Text>
								<Text className="font-ui text-xs text-text-muted">
									{getWorkspacePickerSummary(items)}
								</Text>
							</View>
							{isCurrent ? (
								<View className="h-6 w-6 items-center justify-center rounded-full bg-accent">
									<NavigationIcon className="text-accent-ink" name="check" size={14} />
								</View>
							) : (
								<NavigationIcon className="text-text-subtle" name="chevron-right" size={18} />
							)}
						</Pressable>
					);
				})}
			</View>
			<View className="mt-3.5 gap-2">
				<View className="flex-row items-center justify-between">
					<Text className="font-mono text-[11px] font-bold uppercase tracking-[1.6px] text-text-subtle">
						Saved Views
					</Text>
					<View className="flex-row items-center gap-1">
						<NavigationIcon className="text-accent-text" name="plus" size={14} />
						<Text className="font-ui-medium text-xs text-accent-text">New view</Text>
					</View>
				</View>
				<View className="flex-row flex-wrap gap-2">
					{props.items.savedViews.length === 0 ? (
						<EmptyNavigationSection message="No saved views yet." />
					) : (
						props.items.savedViews.map((item) => (
							<View
								key={item.slug}
								className="h-9 flex-row items-center gap-2 rounded-pill border border-border bg-surface-2 px-3"
							>
								<NavigationIcon className="text-text-muted" name={item.icon} size={15} />
								<Text className="font-ui-medium text-[13.5px] text-text">{item.name}</Text>
							</View>
						))
					)}
				</View>
			</View>
		</BottomSheet>
	);
}

function MobileMoreSheet(props: {
	onClose: () => void;
	items: NavigationItems;
	onNavigate: (item: NavigationItem) => void;
}) {
	const items = props.items;
	return (
		<BottomSheet
			title="More views"
			snapPoints={[570]}
			onClose={props.onClose}
			description="Open and reorder additional views."
			headerAction={
				<View className="h-7.5 flex-row items-center gap-1.5 rounded-pill bg-surface-2 px-3">
					<NavigationIcon className="text-accent-text" name="arrow-up-down" size={14} />
					<Text className="font-ui-semibold text-[13px] text-accent-text">Reorder</Text>
				</View>
			}
		>
			<ScrollView
				className="flex-1"
				showsVerticalScrollIndicator={false}
				contentContainerClassName="gap-1.5 pb-4"
			>
				{items.views.slice(4).map((item) => (
					<Pressable
						key={item.slug}
						accessibilityRole="button"
						accessibilityLabel={item.name}
						onPress={() => props.onNavigate(item)}
						className="h-13 flex-row items-center gap-3 rounded-md bg-surface-2 px-3"
					>
						<View className="h-8 w-8 items-center justify-center rounded-md bg-accent-soft">
							<NavigationIcon className="text-accent-text" name={item.icon} size={17} />
						</View>
						<Text className="flex-1 font-ui-semibold text-[15px] text-text">
							{item.name.replace(/^All /, "")}
						</Text>
						<NavigationIcon className="text-text-subtle" name="grip-vertical" size={17} />
					</Pressable>
				))}
			</ScrollView>
		</BottomSheet>
	);
}

function MobileAccountSheet(props: {
	accountName: string;
	onClose: () => void;
	accountEmail: string;
}) {
	const theme = useAtomValue(themeAtom);
	const setTheme = useAtomSet(themeAtom);

	return (
		<BottomSheet
			title="Account"
			onClose={props.onClose}
			snapPoints={[300]}
			description="View account details and change appearance."
		>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel="Open account profile"
				className="flex-row items-center gap-3 border-b border-border pb-4"
			>
				<View className="h-11 w-11 items-center justify-center rounded-full bg-surface-2">
					<NavigationIcon className="text-text-muted" name="user" size={19} />
				</View>
				<View className="flex-1">
					<Text className="font-ui-medium text-sm text-text">{props.accountName}</Text>
					<Text className="font-ui text-xs text-text-muted">{props.accountEmail}</Text>
				</View>
				<NavigationIcon className="text-text-subtle" name="chevron-right" size={17} />
			</Pressable>
			<View className="mt-4 gap-2">
				<Text className="font-ui-semibold text-[10px] uppercase tracking-[1.6px] text-text-subtle">
					Appearance
				</Text>
				<View className="flex-row rounded-lg border border-border bg-bg p-1">
					{(
						[
							["sun", "Light", "light"],
							["moon", "Dark", "dark"],
							["monitor", "System", "system"],
						] as const
					).map(([icon, label, value]) => (
						<Pressable
							key={label}
							accessibilityRole="button"
							onPress={() => setTheme(value)}
							accessibilityLabel={`Use ${label} appearance`}
							accessibilityState={{ selected: theme === value }}
							className={clsx(
								"flex-1 flex-row items-center justify-center gap-1 rounded-md py-2",
								theme === value && "bg-nav-indicator",
							)}
						>
							<NavigationIcon
								name={icon}
								size={14}
								className={clsx(theme === value ? "text-text" : "text-text-muted")}
							/>
							<Text className="font-ui text-xs text-text">{label}</Text>
						</Pressable>
					))}
				</View>
			</View>
		</BottomSheet>
	);
}

function NavigationStatus(props: { detail?: string; title: string }) {
	return (
		<View className="flex-1 items-center justify-center gap-2 bg-bg px-6">
			<Text className="font-ui-medium text-base text-text">{props.title}</Text>
			{props.detail && (
				<Text className="max-w-xl text-center font-ui text-sm text-text-muted">{props.detail}</Text>
			)}
		</View>
	);
}

export function WorkspaceShell() {
	const client = useAuthClient();
	const pathname = usePathname();
	const insets = useSafeAreaInsets();
	const setWorkspace = useSetWorkspace();
	const selectedWorkspace = useWorkspace();
	const { data: session } = client.useSession();
	const navigationResult = useAtomValue(navigationAtom);
	const params = useGlobalSearchParams<{ workspace?: string }>();
	const routeWorkspace = Array.isArray(params.workspace) ? params.workspace[0] : params.workspace;
	const activeKey = getActiveNavigationKey(pathname);
	const [mobileSheet, setMobileSheet] = useState<"more" | "workspace" | "account" | null>(null);
	const [desktopWorkspaceOpen, setDesktopWorkspaceOpen] = useState(false);
	const [isScrolled, setIsScrolled] = useState(false);
	const isDragging = useRef(false);
	const previousScrollOffset = useRef(0);

	if (AsyncResult.isFailure(navigationResult)) {
		return (
			<NavigationStatus
				title="Unable to load navigation"
				detail={Cause.pretty(navigationResult.cause)}
			/>
		);
	}
	if (!AsyncResult.isSuccess(navigationResult)) {
		return <NavigationStatus title="Loading navigation..." />;
	}

	const decoded = decodeNavigationResponse(navigationResult.value);
	if (Result.isFailure(decoded)) {
		return <NavigationStatus title="Unable to load navigation" detail={String(decoded.failure)} />;
	}
	const data = {
		...decoded.success,
		workspaces: getEnabledItems(decoded.success.workspaces),
	} satisfies NavigationData;
	if (data.workspaces.length === 0) {
		return (
			<NavigationStatus
				title="No enabled workspaces"
				detail="Enable a plugin to create a workspace."
			/>
		);
	}

	const currentWorkspace = getCurrentWorkspace(data.workspaces, routeWorkspace, selectedWorkspace);
	if (!currentWorkspace) {
		return <NavigationStatus title="No workspace selected" />;
	}
	const currentWorkspaceSlug = currentWorkspace.slug;
	const items = getNavigationItems({ data, workspaceSlug: currentWorkspace.slug });
	const accountName = session?.user.name ?? session?.user.email ?? "Account";
	const accountEmail = session?.user.email ?? "Email unavailable";
	function navigate(item: NavigationItem) {
		setMobileSheet(null);
		setDesktopWorkspaceOpen(false);
		router.push(getNavigationHref(currentWorkspaceSlug, item));
	}

	function selectWorkspace(slug: string) {
		if (!data.workspaces.some((item) => item.slug === slug)) {
			return;
		}
		setMobileSheet(null);
		setDesktopWorkspaceOpen(false);
		setWorkspace(slug);
		router.replace({ pathname: "/[workspace]", params: { workspace: slug } });
	}

	return (
		<View className="flex-1 bg-bg">
			<View className="flex-1 flex-row">
				<Sidebar
					items={items}
					onNavigate={navigate}
					activeKey={activeKey}
					accountName={accountName}
					accountEmail={accountEmail}
					key={currentWorkspace.slug}
					workspace={currentWorkspace}
					onAccountOpen={() => setMobileSheet("account")}
					onWorkspaceOpen={() => setDesktopWorkspaceOpen(true)}
				/>
				<View className="relative flex-1">
					<ScrollView
						className="flex-1"
						scrollEventThrottle={16}
						contentContainerClassName="min-h-full px-4 pb-[120px] md:px-8 md:pb-8 md:pt-8"
						onScrollBeginDrag={() => {
							isDragging.current = true;
						}}
						onScrollEndDrag={() => {
							isDragging.current = false;
						}}
						onScroll={(event) => {
							const offsetY = event.nativeEvent.contentOffset.y;
							const previousOffsetY = previousScrollOffset.current;
							previousScrollOffset.current = offsetY;

							if (offsetY > previousOffsetY && offsetY > 24) {
								setIsScrolled(true);
							} else if (isDragging.current && offsetY < previousOffsetY) {
								setIsScrolled(false);
							}
						}}
					>
						<View
							className="md:hidden"
							style={{ height: insets.top + MOBILE_TOP_BAR_HEIGHT + MOBILE_TOP_BAR_GAP }}
						/>
						<Slot />
					</ScrollView>
					{!isScrolled && (
						<Animated.View
							exiting={MOBILE_TOP_BAR_EXITING}
							style={{ paddingTop: insets.top }}
							entering={MOBILE_TOP_BAR_ENTERING}
							className="absolute inset-x-0 top-0 z-20 border-b border-border bg-bg px-4 md:hidden"
						>
							<MobileTopBar
								workspaceIcon={currentWorkspace.icon}
								workspaceName={currentWorkspace.name}
								onAccountOpen={() => setMobileSheet("account")}
								onWorkspaceOpen={() => setMobileSheet("workspace")}
							/>
						</Animated.View>
					)}
					{!mobileSheet && (
						<View
							style={{ paddingBottom: insets.bottom + 12 }}
							className="absolute inset-x-0 bottom-0 z-50 items-start px-4 md:hidden"
						>
							<MobileTabBar
								items={items}
								activeKey={activeKey}
								onNavigate={navigate}
								isCollapsed={isScrolled}
								onExpand={() => setIsScrolled(false)}
								onMoreOpen={() => setMobileSheet("more")}
							/>
						</View>
					)}
					{desktopWorkspaceOpen && (
						<Pressable
							accessibilityRole="button"
							accessibilityLabel="Close navigation overlay"
							className="absolute inset-0 z-30 bg-overlay"
							onPress={() => {
								setDesktopWorkspaceOpen(false);
							}}
						/>
					)}
					{mobileSheet === "more" && (
						<MobileMoreSheet
							items={items}
							onNavigate={navigate}
							onClose={() => setMobileSheet(null)}
						/>
					)}
					{mobileSheet === "workspace" && (
						<MobileWorkspaceSheet
							data={data}
							items={items}
							onSelect={selectWorkspace}
							onClose={() => setMobileSheet(null)}
							currentWorkspaceSlug={currentWorkspace.slug}
						/>
					)}
					{mobileSheet === "account" && (
						<MobileAccountSheet
							accountName={accountName}
							accountEmail={accountEmail}
							onClose={() => setMobileSheet(null)}
						/>
					)}
				</View>
			</View>
			{desktopWorkspaceOpen && (
				<View className="absolute left-69.5 top-19.5 z-50 hidden w-[320px] rounded-xl border border-border bg-surface p-3 shadow-card md:flex">
					<View className="flex-row items-center justify-between px-1 pb-2">
						<Text className="font-ui-semibold text-[10px] uppercase tracking-[1.6px] text-text-subtle">
							Workspaces
						</Text>
						<Pressable
							accessibilityRole="button"
							accessibilityLabel="Close workspace switcher"
							onPress={() => setDesktopWorkspaceOpen(false)}
						>
							<NavigationIcon className="text-text-muted" name="x" size={15} />
						</Pressable>
					</View>
					<View className="h-8 flex-row items-center gap-2 rounded-md border border-border bg-bg px-2">
						<NavigationIcon className="text-text-muted" name="search" size={14} />
						<Text className="font-ui text-xs text-text-muted">Find workspace</Text>
					</View>
					<View className="mt-2 gap-1">
						{data.workspaces.map((item) => {
							const workspaceItems = getNavigationItems({ data, workspaceSlug: item.slug });
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
									{item.slug === currentWorkspace.slug && (
										<NavigationIcon className="text-accent-text" name="check" size={15} />
									)}
								</Pressable>
							);
						})}
					</View>
				</View>
			)}
		</View>
	);
}
