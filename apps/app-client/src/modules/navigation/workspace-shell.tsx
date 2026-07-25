import clsx from "clsx";
import { router, Slot, useLocalSearchParams, usePathname } from "expo-router";
import {
	BookMarked,
	BookOpen,
	Bookmark,
	Check,
	ChevronDown,
	ChevronRight,
	Circle,
	Clapperboard,
	Disc3,
	Dumbbell,
	Film,
	FolderKanban,
	Gamepad2,
	GripVertical,
	Headphones,
	Heart,
	House,
	Inbox,
	Layers3,
	Menu,
	Monitor,
	Moon,
	MoreHorizontal,
	Music2,
	PanelLeft,
	Plus,
	RotateCcw,
	Search,
	Settings,
	Sparkles,
	Star,
	Sun,
	Tags,
	Tv,
	UserCircle,
	Users,
	X,
} from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSetWorkspace } from "@/modules/server/state";

import {
	getActiveNavigationKey,
	getNavigationHref,
	getNavigationItems,
	navigationData,
	type NavigationItem,
} from "./navigation-data";

const iconMap = {
	"book-marked": BookMarked,
	"book-open": BookOpen,
	bookmark: Bookmark,
	check: Check,
	"chevron-right": ChevronRight,
	clapperboard: Clapperboard,
	"disc-3": Disc3,
	dumbbell: Dumbbell,
	film: Film,
	"folder-kanban": FolderKanban,
	"gamepad-2": Gamepad2,
	"grip-vertical": GripVertical,
	headphones: Headphones,
	heart: Heart,
	house: House,
	inbox: Inbox,
	"layers-3": Layers3,
	menu: Menu,
	monitor: Monitor,
	moon: Moon,
	"more-horizontal": MoreHorizontal,
	"music-2": Music2,
	"panel-left": PanelLeft,
	plus: Plus,
	"rotate-ccw": RotateCcw,
	search: Search,
	settings: Settings,
	sparkles: Sparkles,
	star: Star,
	sun: Sun,
	tags: Tags,
	tv: Tv,
	user: UserCircle,
	users: Users,
	x: X,
} as const;

function NavigationIcon(props: { name: string; size?: number }) {
	const Icon = Object.entries(iconMap).find(([name]) => name === props.name)?.[1] ?? Circle;
	return <Icon size={props.size ?? 16} color="currentColor" strokeWidth={1.7} />;
}

function NavigationRow(props: {
	item: NavigationItem;
	isActive: boolean;
	onPress: () => void;
	reordering?: boolean;
	onReorder?: () => void;
}) {
	return (
		<Pressable
			accessibilityLabel={props.item.name}
			accessibilityRole="button"
			onPress={props.onPress}
			className={clsx(
				"min-h-7 flex-row items-center gap-2 rounded-md px-2",
				props.isActive ? "bg-nav-indicator text-text" : "text-text-muted",
			)}
		>
			{props.reordering && (
				<Pressable
					accessibilityLabel={`Move ${props.item.name} down`}
					accessibilityRole="button"
					onPress={props.onReorder}
					className="-ml-1 p-1 text-text-muted"
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

function WorkspaceTrigger(props: {
	workspace: (typeof navigationData.workspaces)[number];
	onPress: () => void;
}) {
	const workspace = props.workspace;
	return (
		<Pressable
			accessibilityLabel="Switch workspace"
			accessibilityRole="button"
			onPress={props.onPress}
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
				<ChevronDown size={15} color="currentColor" strokeWidth={1.7} />
			</View>
		</Pressable>
	);
}

function Sidebar(props: {
	activeKey: string;
	workspace: (typeof navigationData.workspaces)[number];
	onNavigate: (item: NavigationItem) => void;
	onWorkspaceOpen: () => void;
	onAccountOpen: () => void;
}) {
	const items = getNavigationItems();
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
		<View className="relative hidden w-[264px] flex-col border-r border-border bg-surface md:flex">
			<ScrollView
				showsVerticalScrollIndicator={false}
				contentContainerClassName="gap-2 px-3 pb-5 pt-[18px]"
			>
				<WorkspaceTrigger onPress={props.onWorkspaceOpen} workspace={props.workspace} />
				<View className="h-8 flex-row items-center gap-2 rounded-md border border-border bg-bg px-2.5 text-text-muted">
					<NavigationIcon name="search" size={15} />
					<TextInput
						accessibilityLabel="Search navigation"
						className="min-w-0 flex-1 py-0 font-ui text-xs text-text"
						placeholder="Search"
						returnKeyType="search"
						onSubmitEditing={() => undefined}
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
								accessibilityLabel={isReordering ? "Finish reordering views" : "Reorder views"}
								accessibilityRole="button"
								onPress={() => setIsReordering((current) => !current)}
								className="px-1 text-accent-text"
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
								isActive={
									item.kind === "home"
										? props.activeKey === "home"
										: props.activeKey === `view:${item.slug}`
								}
								item={item}
								key={item.slug}
								onPress={() => props.onNavigate(item)}
								onReorder={() => moveView(viewOrder.indexOf(item))}
								reordering={isReordering}
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
					{items.collections.map((item) => (
						<NavigationRow
							isActive={props.activeKey === `collection:${item.slug}`}
							item={item}
							key={item.slug}
							onPress={() => props.onNavigate(item)}
						/>
					))}
				</View>

				<View className="gap-1">
					<SectionHeader
						title="Saved Views"
						count={items.savedViews.length}
						action={<Text className="font-ui-medium text-xs text-accent-text">New</Text>}
					/>
					{items.savedViews.map((item) => (
						<NavigationRow
							isActive={props.activeKey === `view:${item.slug}`}
							item={item}
							key={item.slug}
							onPress={() => props.onNavigate(item)}
						/>
					))}
				</View>
			</ScrollView>
			<View className="border-t border-border px-3 py-3">
				<Pressable
					accessibilityLabel="Open account settings"
					accessibilityRole="button"
					onPress={props.onAccountOpen}
					className="flex-row items-center gap-2 rounded-md px-2 py-1.5"
				>
					<View className="h-7 w-7 items-center justify-center rounded-full bg-surface-2 text-text-muted">
						<NavigationIcon name="user" size={15} />
					</View>
					<View className="flex-1">
						<Text className="font-ui-medium text-xs text-text">Diptesh</Text>
						<Text className="font-ui text-[10px] text-text-muted">Personal account</Text>
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
	workspaceName: string;
	onWorkspaceOpen: () => void;
	onAccountOpen: () => void;
}) {
	return (
		<View className="flex-row items-center gap-3 rounded-xl border border-border bg-nav-surface px-3 py-2 shadow-sm">
			<Pressable
				accessibilityLabel="Open account"
				accessibilityRole="button"
				onPress={props.onAccountOpen}
				className="h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-text-muted"
			>
				<NavigationIcon name="user" size={18} />
			</Pressable>
			<View className="h-10 flex-1 flex-row items-center gap-2 rounded-lg bg-bg px-3 text-text-muted">
				<NavigationIcon name="search" size={17} />
				<Text className="font-ui text-sm text-text-muted">Search</Text>
			</View>
			<Pressable
				accessibilityLabel={`Switch workspace, current workspace ${props.workspaceName}`}
				accessibilityRole="button"
				onPress={props.onWorkspaceOpen}
				className="h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent-text"
			>
				<NavigationIcon name="clapperboard" size={17} />
			</Pressable>
		</View>
	);
}

function MobileTabBar(props: {
	activeKey: string;
	onNavigate: (item: NavigationItem) => void;
	onMoreOpen: () => void;
}) {
	const items = getNavigationItems().views.slice(0, 4);
	return (
		<View className="flex-row items-center gap-1 rounded-pill border border-nav-border bg-nav-surface p-1.5 shadow-card">
			{items.map((item) => {
				const isActive =
					item.kind === "home"
						? props.activeKey === "home"
						: props.activeKey === `view:${item.slug}`;
				return (
					<Pressable
						accessibilityLabel={item.name}
						accessibilityRole="button"
						key={item.slug}
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
				accessibilityLabel="Open more navigation"
				accessibilityRole="button"
				onPress={props.onMoreOpen}
				className="h-10 w-10 items-center justify-center rounded-pill text-text-muted"
			>
				<NavigationIcon name="more-horizontal" size={19} />
			</Pressable>
		</View>
	);
}

function Sheet(props: {
	title: string;
	children: ReactNode;
	onClose: () => void;
	className?: string;
}) {
	return (
		<View
			className={clsx(
				"absolute inset-x-0 bottom-0 z-40 max-h-[75%] rounded-t-2xl border-t border-border bg-surface px-4 pb-4 pt-2 shadow-card",
				props.className,
			)}
		>
			<Pressable
				accessibilityLabel="Close sheet"
				accessibilityRole="button"
				onPress={props.onClose}
				className="h-1 items-center"
			>
				<View className="h-1 w-10 rounded-pill bg-border-strong" />
			</Pressable>
			<View className="flex-row items-center justify-between py-4">
				<Text className="font-display-semibold text-xl text-text">{props.title}</Text>
				<Pressable
					accessibilityLabel="Close sheet"
					accessibilityRole="button"
					onPress={props.onClose}
					className="p-1 text-text-muted"
				>
					<NavigationIcon name="x" size={17} />
				</Pressable>
			</View>
			{props.children}
		</View>
	);
}

function MobileWorkspaceSheet(props: { onClose: () => void; onSelect: (slug: string) => void }) {
	return (
		<Sheet title="Workspaces" onClose={props.onClose} className="h-[465px]">
			<View className="gap-2">
				{navigationData.workspaces.map((workspace, index) => (
					<Pressable
						accessibilityLabel={`Switch to ${workspace.name} workspace`}
						accessibilityRole="button"
						key={workspace.slug}
						onPress={() => props.onSelect(workspace.slug)}
						className="flex-row items-center gap-3 rounded-lg border border-border px-3 py-3"
					>
						<View className="h-11 w-11 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
							<NavigationIcon name={workspace.icon} size={20} />
						</View>
						<View className="flex-1">
							<Text className="font-ui-medium text-sm text-text">{workspace.name}</Text>
							<Text className="font-ui text-xs text-text-muted">{workspace.description}</Text>
						</View>
						{index === 0 ? (
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
					showsHorizontalScrollIndicator={false}
					contentContainerClassName="gap-2"
				>
					{getNavigationItems().savedViews.map((item) => (
						<View
							className="flex-row items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2"
							key={item.slug}
						>
							<NavigationIcon name={item.icon} size={15} />
							<Text className="font-ui text-xs text-text">{item.name}</Text>
						</View>
					))}
				</ScrollView>
			</View>
		</Sheet>
	);
}

function MobileMoreSheet(props: {
	onClose: () => void;
	onNavigate: (item: NavigationItem) => void;
}) {
	const items = getNavigationItems();
	return (
		<Sheet title="More Views" onClose={props.onClose} className="h-[570px]">
			<ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="gap-2 pb-4">
				{items.views.slice(4).map((item) => (
					<Pressable
						accessibilityLabel={item.name}
						accessibilityRole="button"
						key={item.slug}
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
							accessibilityLabel="Create saved view"
							accessibilityRole="button"
							className="flex-row items-center gap-1 text-accent-text"
						>
							<NavigationIcon name="plus" size={14} />
							<Text className="font-ui-medium text-xs text-accent-text">New</Text>
						</Pressable>
					</View>
					<View className="flex-row flex-wrap gap-2">
						{[...items.collections, ...items.savedViews].map((item) => (
							<View
								className="flex-row items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2"
								key={`${item.kind}-${item.slug}`}
							>
								<NavigationIcon name={item.icon} size={14} />
								<Text className="font-ui text-xs text-text">{item.name}</Text>
							</View>
						))}
					</View>
				</View>
			</ScrollView>
		</Sheet>
	);
}

function MobileAccountSheet(props: { onClose: () => void }) {
	return (
		<Sheet title="Account" onClose={props.onClose} className="h-[300px]">
			<Pressable
				accessibilityLabel="Open account profile"
				accessibilityRole="button"
				className="flex-row items-center gap-3 border-b border-border pb-4"
			>
				<View className="h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-text-muted">
					<NavigationIcon name="user" size={19} />
				</View>
				<View className="flex-1">
					<Text className="font-ui-medium text-sm text-text">Diptesh</Text>
					<Text className="font-ui text-xs text-text-muted">Personal account</Text>
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
							accessibilityLabel={`Use ${label} appearance`}
							accessibilityRole="button"
							className={clsx(
								"flex-1 flex-row items-center justify-center gap-1 rounded-md py-2",
								index === 0 && "bg-nav-indicator",
							)}
							key={label}
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

export function WorkspaceShell() {
	const insets = useSafeAreaInsets();
	const pathname = usePathname();
	const params = useLocalSearchParams<{ workspace: string }>();
	const setWorkspace = useSetWorkspace();
	const workspace = Array.isArray(params.workspace) ? params.workspace[0] : params.workspace;
	const activeKey = getActiveNavigationKey(pathname);
	const [mobileSheet, setMobileSheet] = useState<"more" | "workspace" | "account" | null>(null);
	const [desktopWorkspaceOpen, setDesktopWorkspaceOpen] = useState(false);
	const [isScrolled, setIsScrolled] = useState(false);

	const currentWorkspace =
		navigationData.workspaces.find((item) => item.slug === workspace) ??
		navigationData.workspaces[0];

	function navigate(item: NavigationItem) {
		setMobileSheet(null);
		setDesktopWorkspaceOpen(false);
		router.push(getNavigationHref(workspace, item));
	}

	function selectWorkspace(slug: string) {
		setMobileSheet(null);
		setDesktopWorkspaceOpen(false);
		setWorkspace(slug);
		router.replace({ pathname: "/[workspace]", params: { workspace: slug } });
	}

	return (
		<View className="flex-1 bg-bg">
			<View className="flex-1 flex-row">
				<Sidebar
					activeKey={activeKey}
					onAccountOpen={() => setMobileSheet("account")}
					onNavigate={navigate}
					onWorkspaceOpen={() => setDesktopWorkspaceOpen(true)}
					workspace={currentWorkspace}
				/>
				<View className="relative flex-1">
					<ScrollView
						className="flex-1"
						onScroll={(event) => setIsScrolled(event.nativeEvent.contentOffset.y > 24)}
						scrollEventThrottle={16}
						contentContainerClassName="min-h-full px-4 pb-[120px] pt-[110px] md:px-8 md:pb-8 md:pt-8"
					>
						<Slot />
					</ScrollView>
					<View
						className="absolute inset-x-0 top-0 z-20 px-4 md:hidden"
						style={{ paddingTop: insets.top + 12 }}
					>
						<MobileTopBar
							onAccountOpen={() => setMobileSheet("account")}
							onWorkspaceOpen={() => setMobileSheet("workspace")}
							workspaceName={currentWorkspace.name}
						/>
					</View>
					<View
						className="absolute inset-x-0 bottom-0 z-50 items-start px-4 md:hidden"
						style={{ paddingBottom: insets.bottom + 12 }}
					>
						{isScrolled ? (
							<Pressable
								accessibilityLabel="Open navigation"
								accessibilityRole="button"
								onPress={() => setMobileSheet("more")}
								className="h-14 w-14 items-center justify-center rounded-full border border-nav-border bg-nav-surface text-accent-text shadow-card"
							>
								<NavigationIcon name="panel-left" size={20} />
							</Pressable>
						) : (
							<MobileTabBar
								activeKey={activeKey}
								onMoreOpen={() => setMobileSheet("more")}
								onNavigate={navigate}
							/>
						)}
					</View>
					{(mobileSheet ?? desktopWorkspaceOpen) && (
						<Pressable
							accessibilityLabel="Close navigation overlay"
							accessibilityRole="button"
							onPress={() => {
								setMobileSheet(null);
								setDesktopWorkspaceOpen(false);
							}}
							className="absolute inset-0 z-30 bg-black/40 md:bg-black/20"
						/>
					)}
					{mobileSheet === "more" && (
						<MobileMoreSheet onClose={() => setMobileSheet(null)} onNavigate={navigate} />
					)}
					{mobileSheet === "workspace" && (
						<MobileWorkspaceSheet onClose={() => setMobileSheet(null)} onSelect={selectWorkspace} />
					)}
					{mobileSheet === "account" && <MobileAccountSheet onClose={() => setMobileSheet(null)} />}
				</View>
			</View>
			{desktopWorkspaceOpen && (
				<View className="absolute left-[278px] top-[78px] z-50 hidden w-[320px] rounded-xl border border-border bg-surface p-3 shadow-card md:flex">
					<View className="flex-row items-center justify-between px-1 pb-2">
						<Text className="font-ui-semibold text-xs text-text">Switch workspace</Text>
						<Pressable
							accessibilityLabel="Close workspace switcher"
							accessibilityRole="button"
							onPress={() => setDesktopWorkspaceOpen(false)}
							className="text-text-muted"
						>
							<NavigationIcon name="x" size={15} />
						</Pressable>
					</View>
					<View className="h-8 flex-row items-center gap-2 rounded-md border border-border bg-bg px-2 text-text-muted">
						<NavigationIcon name="search" size={14} />
						<Text className="font-ui text-xs text-text-muted">Filter workspaces</Text>
					</View>
					<View className="mt-2 gap-1">
						{navigationData.workspaces.map((item) => (
							<Pressable
								accessibilityLabel={`Switch to ${item.name} workspace`}
								accessibilityRole="button"
								key={item.slug}
								onPress={() => selectWorkspace(item.slug)}
								className="flex-row items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2"
							>
								<View className="h-8 w-8 items-center justify-center rounded-md bg-accent-soft text-accent-text">
									<NavigationIcon name={item.icon} size={15} />
								</View>
								<View className="flex-1">
									<Text className="font-ui-medium text-xs text-text">{item.name}</Text>
									<Text className="font-ui text-[10px] text-text-muted">{item.description}</Text>
								</View>
								{item.slug === workspace && <NavigationIcon name="check" size={15} />}
							</Pressable>
						))}
					</View>
				</View>
			)}
		</View>
	);
}
