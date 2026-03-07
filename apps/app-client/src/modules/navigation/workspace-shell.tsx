import { useAtomValue } from "@effect/atom-react";
import clsx from "clsx";
import { Cause } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { router, Slot, useLocalSearchParams, usePathname } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { collectionsAtom, pluginsAtom, savedViewsAtom } from "@/api/atoms";
import { useAuthClient } from "@/modules/auth/client";
import { AppIcon as NavigationIcon } from "@/modules/icons";
import { useSetWorkspace, useWorkspace } from "@/modules/server/state";

import {
	buildNavigationData,
	getActiveNavigationKey,
	getCurrentWorkspace,
	getNavigationHref,
	getNavigationItems,
	type NavigationData,
	type NavigationItem,
	type NavigationItems,
	type NavigationWorkspace,
} from "./navigation-data";

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
				props.isActive ? "bg-nav-indicator text-text" : "text-text-muted",
			)}
		>
			{props.reordering && (
				<Pressable
					onPress={props.onReorder}
					accessibilityRole="button"
					className="-ml-1 p-1 text-text-muted"
					accessibilityLabel={`Move ${props.item.name} down`}
				>
					<NavigationIcon name="grip-vertical" size={14} />
				</Pressable>
			)}
			<View className="text-text-muted">
				<NavigationIcon name={props.item.icon} size={15} />
			</View>
			<Text
				className={clsx(
					"flex-1 font-ui text-sm",
					props.isActive ? "font-ui-medium text-text" : "text-text-muted",
				)}
			>
				{props.item.name}
			</Text>
			{!props.reordering && props.item.kind !== "home" && (
				<View className="text-text-subtle">
					<NavigationIcon name="chevron-right" size={14} />
				</View>
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

function WorkspaceTrigger(props: { workspace: NavigationWorkspace; onPress: () => void }) {
	const workspace = props.workspace;
	return (
		<Pressable
			onPress={props.onPress}
			accessibilityRole="button"
			accessibilityLabel="Switch workspace"
			className="flex-row items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-2"
		>
			<View className="h-7 w-7 items-center justify-center rounded-md bg-accent-soft text-accent-text">
				<NavigationIcon name={workspace.icon} size={15} />
			</View>
			<View className="min-w-0 flex-1">
				<Text className="font-ui-medium text-sm text-text">{workspace.name}</Text>
				<Text className="font-ui text-[11px] text-text-muted">{workspace.description}</Text>
			</View>
			<View className="text-text-subtle">
				<NavigationIcon name="chevron-down" size={15} />
			</View>
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
				showsVerticalScrollIndicator={false}
				contentContainerClassName="gap-2 px-3 pb-5 pt-[18px]"
			>
				<WorkspaceTrigger onPress={props.onWorkspaceOpen} workspace={props.workspace} />
				<View className="h-8 flex-row items-center gap-2 rounded-md border border-border bg-bg px-2.5 text-text-muted">
					<NavigationIcon name="search" size={15} />
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
					<View className="gap-0.5">
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
					</View>
				</View>

				<View className="my-2 h-px bg-border" />
				<View className="gap-1">
					<SectionHeader
						title="Collections"
						count={items.collections.length}
						action={<Text className="font-ui-medium text-xs text-accent-text">New</Text>}
					/>
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
				</View>

				<View className="gap-1">
					<SectionHeader
						title="Saved Views"
						count={items.savedViews.length}
						action={<Text className="font-ui-medium text-xs text-accent-text">New</Text>}
					/>
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
				</View>
			</ScrollView>
			<View className="border-t border-border px-3 py-3">
				<Pressable
					accessibilityRole="button"
					onPress={props.onAccountOpen}
					accessibilityLabel="Open account settings"
					className="flex-row items-center gap-2 rounded-md px-2 py-1.5"
				>
					<View className="h-7 w-7 items-center justify-center rounded-full bg-surface-2 text-text-muted">
						<NavigationIcon name="user" size={15} />
					</View>
					<View className="flex-1">
						<Text className="font-ui-medium text-xs text-text">{props.accountName}</Text>
						<Text className="font-ui text-[10px] text-text-muted">{props.accountEmail}</Text>
					</View>
					<View className="flex-row gap-2 text-text-subtle">
						<NavigationIcon name="moon" size={15} />
						<NavigationIcon name="settings" size={15} />
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
		<View className="flex-row items-center gap-3 rounded-xl border border-border bg-nav-surface px-3 py-2 shadow-sm">
			<Pressable
				accessibilityRole="button"
				onPress={props.onAccountOpen}
				accessibilityLabel="Open account"
				className="h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-text-muted"
			>
				<NavigationIcon name="user" size={18} />
			</Pressable>
			<View className="h-10 flex-1 flex-row items-center gap-2 rounded-lg bg-bg px-3 text-text-muted">
				<NavigationIcon name="search" size={17} />
				<Text className="font-ui text-sm text-text-muted">Search</Text>
			</View>
			<Pressable
				accessibilityRole="button"
				onPress={props.onWorkspaceOpen}
				accessibilityLabel={`Switch workspace, current workspace ${props.workspaceName}`}
				className="h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent-text"
			>
				<NavigationIcon name={props.workspaceIcon} size={17} />
			</Pressable>
		</View>
	);
}

function MobileTabBar(props: {
	activeKey: string;
	items: NavigationItems;
	onMoreOpen: () => void;
	onNavigate: (item: NavigationItem) => void;
}) {
	const items = props.items.views.slice(0, 4);
	return (
		<View className="flex-row items-center gap-1 rounded-pill border border-nav-border bg-nav-surface p-1.5 shadow-card">
			{items.map((item) => {
				const isActive =
					item.kind === "home"
						? props.activeKey === "home"
						: props.activeKey === `view:${item.slug}`;
				return (
					<Pressable
						key={item.slug}
						accessibilityRole="button"
						accessibilityLabel={item.name}
						onPress={() => props.onNavigate(item)}
						className={clsx(
							"h-10 flex-row items-center justify-center gap-1.5 rounded-pill px-3",
							isActive ? "bg-nav-indicator text-accent-text" : "text-text-muted",
						)}
					>
						<NavigationIcon name={item.icon} size={18} />
						{isActive && (
							<Text className="font-ui-medium text-xs text-accent-text">{item.name}</Text>
						)}
					</Pressable>
				);
			})}
			<Pressable
				accessibilityRole="button"
				onPress={props.onMoreOpen}
				accessibilityLabel="Open more navigation"
				className="h-10 w-10 items-center justify-center rounded-pill text-text-muted"
			>
				<NavigationIcon name="more-horizontal" size={19} />
			</Pressable>
		</View>
	);
}

function Sheet(props: {
	title: string;
	className?: string;
	children: ReactNode;
	onClose: () => void;
}) {
	return (
		<View
			className={clsx(
				"absolute inset-x-0 bottom-0 z-40 max-h-[75%] rounded-t-2xl border-t border-border bg-surface px-4 pb-4 pt-2 shadow-card",
				props.className,
			)}
		>
			<Pressable
				onPress={props.onClose}
				accessibilityRole="button"
				className="h-1 items-center"
				accessibilityLabel="Close sheet"
			>
				<View className="h-1 w-10 rounded-pill bg-border-strong" />
			</Pressable>
			<View className="flex-row items-center justify-between py-4">
				<Text className="font-display-semibold text-xl text-text">{props.title}</Text>
				<Pressable
					onPress={props.onClose}
					accessibilityRole="button"
					className="p-1 text-text-muted"
					accessibilityLabel="Close sheet"
				>
					<NavigationIcon name="x" size={17} />
				</Pressable>
			</View>
			{props.children}
		</View>
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
		<Sheet title="Workspaces" onClose={props.onClose} className="h-116.25">
			<View className="gap-2">
				{props.data.workspaces.map((workspace) => (
					<Pressable
						key={workspace.slug}
						accessibilityRole="button"
						onPress={() => props.onSelect(workspace.slug)}
						accessibilityLabel={`Switch to ${workspace.name} workspace`}
						className="flex-row items-center gap-3 rounded-lg border border-border px-3 py-3"
					>
						<View className="h-11 w-11 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
							<NavigationIcon name={workspace.icon} size={20} />
						</View>
						<View className="flex-1">
							<Text className="font-ui-medium text-sm text-text">{workspace.name}</Text>
							<Text className="font-ui text-xs text-text-muted">{workspace.description}</Text>
						</View>
						{workspace.slug === props.currentWorkspaceSlug ? (
							<NavigationIcon name="check" size={17} />
						) : (
							<NavigationIcon name="chevron-right" size={17} />
						)}
					</Pressable>
				))}
			</View>
			<View className="mt-5 gap-2">
				<Text className="font-ui-semibold text-[10px] uppercase tracking-[1.6px] text-text-subtle">
					Saved Views
				</Text>
				<ScrollView
					horizontal
					contentContainerClassName="gap-2"
					showsHorizontalScrollIndicator={false}
				>
					{props.items.savedViews.length === 0 ? (
						<EmptyNavigationSection message="No saved views yet." />
					) : (
						props.items.savedViews.map((item) => (
							<View
								className="flex-row items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2"
								key={item.slug}
							>
								<NavigationIcon name={item.icon} size={15} />
								<Text className="font-ui text-xs text-text">{item.name}</Text>
							</View>
						))
					)}
				</ScrollView>
			</View>
		</Sheet>
	);
}

function MobileMoreSheet(props: {
	onClose: () => void;
	items: NavigationItems;
	onNavigate: (item: NavigationItem) => void;
}) {
	const items = props.items;
	return (
		<Sheet title="More Views" onClose={props.onClose} className="h-142.5">
			<ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="gap-2 pb-4">
				{items.views.slice(4).map((item) => (
					<Pressable
						key={item.slug}
						accessibilityRole="button"
						accessibilityLabel={item.name}
						onPress={() => props.onNavigate(item)}
						className="flex-row items-center gap-3 rounded-lg border border-border px-3 py-3"
					>
						<View className="h-8 w-8 items-center justify-center rounded-md bg-surface-2 text-text-muted">
							<NavigationIcon name={item.icon} size={16} />
						</View>
						<Text className="flex-1 font-ui text-sm text-text">{item.name}</Text>
						<NavigationIcon name="grip-vertical" size={16} />
					</Pressable>
				))}
				<View className="mt-4 gap-2">
					<View className="flex-row items-center justify-between">
						<Text className="font-ui-semibold text-[10px] uppercase tracking-[1.6px] text-text-subtle">
							Saved Views
						</Text>
						<Pressable
							accessibilityRole="button"
							accessibilityLabel="Create saved view"
							className="flex-row items-center gap-1 text-accent-text"
						>
							<NavigationIcon name="plus" size={14} />
							<Text className="font-ui-medium text-xs text-accent-text">New</Text>
						</Pressable>
					</View>
					<View className="flex-row flex-wrap gap-2">
						{items.collections.length === 0 && items.savedViews.length === 0 ? (
							<EmptyNavigationSection message="No collections or saved views yet." />
						) : (
							[...items.collections, ...items.savedViews].map((item) => (
								<View
									className="flex-row items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2"
									key={`${item.kind}-${item.slug}`}
								>
									<NavigationIcon name={item.icon} size={14} />
									<Text className="font-ui text-xs text-text">{item.name}</Text>
								</View>
							))
						)}
					</View>
				</View>
			</ScrollView>
		</Sheet>
	);
}

function MobileAccountSheet(props: {
	accountName: string;
	onClose: () => void;
	accountEmail: string;
}) {
	return (
		<Sheet title="Account" onClose={props.onClose} className="h-75">
			<Pressable
				accessibilityRole="button"
				accessibilityLabel="Open account profile"
				className="flex-row items-center gap-3 border-b border-border pb-4"
			>
				<View className="h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-text-muted">
					<NavigationIcon name="user" size={19} />
				</View>
				<View className="flex-1">
					<Text className="font-ui-medium text-sm text-text">{props.accountName}</Text>
					<Text className="font-ui text-xs text-text-muted">{props.accountEmail}</Text>
				</View>
				<NavigationIcon name="chevron-right" size={17} />
			</Pressable>
			<View className="mt-4 gap-2">
				<Text className="font-ui-semibold text-[10px] uppercase tracking-[1.6px] text-text-subtle">
					Appearance
				</Text>
				<View className="flex-row rounded-lg border border-border bg-bg p-1">
					{[
						["sun", "Light"],
						["moon", "Dark"],
						["monitor", "System"],
					].map(([icon, label], index) => (
						<Pressable
							key={label}
							accessibilityRole="button"
							accessibilityLabel={`Use ${label} appearance`}
							className={clsx(
								"flex-1 flex-row items-center justify-center gap-1 rounded-md py-2",
								index === 0 && "bg-nav-indicator",
							)}
						>
							<NavigationIcon name={icon} size={14} />
							<Text className="font-ui text-xs text-text">{label}</Text>
						</Pressable>
					))}
				</View>
				<Text className="font-ui text-[11px] text-text-muted">
					Theme selection will be connected when account preferences are available.
				</Text>
			</View>
		</Sheet>
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
	const pluginsResult = useAtomValue(pluginsAtom);
	const savedViewsResult = useAtomValue(savedViewsAtom);
	const collectionsResult = useAtomValue(collectionsAtom);
	const params = useLocalSearchParams<{ workspace?: string }>();
	const routeWorkspace = Array.isArray(params.workspace) ? params.workspace[0] : params.workspace;
	const activeKey = getActiveNavigationKey(pathname);
	const [mobileSheet, setMobileSheet] = useState<"more" | "workspace" | "account" | null>(null);
	const [desktopWorkspaceOpen, setDesktopWorkspaceOpen] = useState(false);
	const [isScrolled, setIsScrolled] = useState(false);

	if (AsyncResult.isFailure(pluginsResult)) {
		return (
			<NavigationStatus
				title="Unable to load workspaces"
				detail={Cause.pretty(pluginsResult.cause)}
			/>
		);
	}
	if (AsyncResult.isFailure(savedViewsResult)) {
		return (
			<NavigationStatus
				title="Unable to load saved views"
				detail={Cause.pretty(savedViewsResult.cause)}
			/>
		);
	}
	if (AsyncResult.isFailure(collectionsResult)) {
		return (
			<NavigationStatus
				title="Unable to load collections"
				detail={Cause.pretty(collectionsResult.cause)}
			/>
		);
	}
	if (
		!AsyncResult.isSuccess(pluginsResult) ||
		!AsyncResult.isSuccess(savedViewsResult) ||
		!AsyncResult.isSuccess(collectionsResult)
	) {
		return <NavigationStatus title="Loading navigation..." />;
	}

	const data = buildNavigationData({
		collections: collectionsResult.value,
		plugins: pluginsResult.value,
		savedViews: savedViewsResult.value,
	});
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
						onScroll={(event) => setIsScrolled(event.nativeEvent.contentOffset.y > 24)}
						contentContainerClassName="min-h-full px-4 pb-[120px] pt-[110px] md:px-8 md:pb-8 md:pt-8"
					>
						<Slot />
					</ScrollView>
					<View
						className="absolute inset-x-0 top-0 z-20 px-4 md:hidden"
						style={{ paddingTop: insets.top + 12 }}
					>
						<MobileTopBar
							workspaceIcon={currentWorkspace.icon}
							workspaceName={currentWorkspace.name}
							onAccountOpen={() => setMobileSheet("account")}
							onWorkspaceOpen={() => setMobileSheet("workspace")}
						/>
					</View>
					<View
						className="absolute inset-x-0 bottom-0 z-50 items-start px-4 md:hidden"
						style={{ paddingBottom: insets.bottom + 12 }}
					>
						{isScrolled ? (
							<Pressable
								accessibilityRole="button"
								accessibilityLabel="Open navigation"
								onPress={() => setMobileSheet("more")}
								className="h-14 w-14 items-center justify-center rounded-full border border-nav-border bg-nav-surface text-accent-text shadow-card"
							>
								<NavigationIcon name="panel-left" size={20} />
							</Pressable>
						) : (
							<MobileTabBar
								items={items}
								onNavigate={navigate}
								activeKey={activeKey}
								onMoreOpen={() => setMobileSheet("more")}
							/>
						)}
					</View>
					{(mobileSheet ?? desktopWorkspaceOpen) && (
						<Pressable
							accessibilityRole="button"
							accessibilityLabel="Close navigation overlay"
							className="absolute inset-0 z-30 bg-black/40 md:bg-black/20"
							onPress={() => {
								setMobileSheet(null);
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
						<Text className="font-ui-semibold text-xs text-text">Switch workspace</Text>
						<Pressable
							accessibilityRole="button"
							className="text-text-muted"
							accessibilityLabel="Close workspace switcher"
							onPress={() => setDesktopWorkspaceOpen(false)}
						>
							<NavigationIcon name="x" size={15} />
						</Pressable>
					</View>
					<View className="h-8 flex-row items-center gap-2 rounded-md border border-border bg-bg px-2 text-text-muted">
						<NavigationIcon name="search" size={14} />
						<Text className="font-ui text-xs text-text-muted">Filter workspaces</Text>
					</View>
					<View className="mt-2 gap-1">
						{data.workspaces.map((item) => (
							<Pressable
								key={item.slug}
								accessibilityRole="button"
								onPress={() => selectWorkspace(item.slug)}
								accessibilityLabel={`Switch to ${item.name} workspace`}
								className="flex-row items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2"
							>
								<View className="h-8 w-8 items-center justify-center rounded-md bg-accent-soft text-accent-text">
									<NavigationIcon name={item.icon} size={15} />
								</View>
								<View className="flex-1">
									<Text className="font-ui-medium text-xs text-text">{item.name}</Text>
									<Text className="font-ui text-[10px] text-text-muted">{item.description}</Text>
								</View>
								{item.slug === currentWorkspace.slug && <NavigationIcon name="check" size={15} />}
							</Pressable>
						))}
					</View>
				</View>
			)}
		</View>
	);
}
