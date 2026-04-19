import clsx from "clsx";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { BackHandler, Platform, Pressable, useWindowDimensions, View } from "react-native";
import Animated, {
	ReduceMotion,
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { NavigationItem } from "./navigation-data";
import { Sidebar } from "./sidebar";
import type { ReadyWorkspaceNavigation } from "./use-workspace-navigation";
import { WorkspaceSheet } from "./workspace-sheets";

const DRAWER_MAX_WIDTH = 320;
const DRAWER_WIDTH_RATIO = 0.82;
const DRAWER_TIMING = { duration: 240, reduceMotion: ReduceMotion.System };
const DRAWER_WEB_HIDDEN = Platform.OS === "web" ? "md:hidden" : null;
const WEB_SIDEBAR_BREAKPOINT = 768;

function getDrawerWidth(screenWidth: number) {
	return Math.min(DRAWER_MAX_WIDTH, Math.round(screenWidth * DRAWER_WIDTH_RATIO));
}

type WorkspaceDrawerValue = {
	openDrawer: () => void;
	navigation: ReadyWorkspaceNavigation;
};

const WorkspaceDrawerContext = createContext<WorkspaceDrawerValue | null>(null);

export function useWorkspaceDrawer() {
	const value = useContext(WorkspaceDrawerContext);
	if (!value) {
		throw new Error("Workspace drawer is unavailable");
	}
	return value;
}

export function WorkspaceDrawer(props: {
	children: ReactNode;
	navigation: ReadyWorkspaceNavigation;
}) {
	const insets = useSafeAreaInsets();
	const { width } = useWindowDimensions();
	const progress = useSharedValue(0);
	const drawerWidth = getDrawerWidth(width);
	const [isOpen, setIsOpen] = useState(false);
	const [sheet, setSheet] = useState<"workspace" | null>(null);

	const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
	const contentStyle = useAnimatedStyle(() => ({
		transform: [{ translateX: progress.value * drawerWidth }],
	}));
	const drawerStyle = useAnimatedStyle(() => ({
		transform: [{ translateX: (progress.value - 1) * drawerWidth }],
	}));

	useEffect(() => {
		const subscription =
			isOpen && Platform.OS === "android"
				? BackHandler.addEventListener("hardwareBackPress", () => {
						setIsOpen(false);
						progress.value = withTiming(0, DRAWER_TIMING);
						return true;
					})
				: null;
		return () => subscription?.remove();
	}, [isOpen, progress]);

	useEffect(() => {
		if (Platform.OS === "web" && width >= WEB_SIDEBAR_BREAKPOINT) {
			setIsOpen(false);
			progress.value = 0;
		}
	}, [progress, width]);

	const drawerValue = useMemo<WorkspaceDrawerValue>(
		() => ({
			navigation: props.navigation,
			openDrawer: () => {
				setIsOpen(true);
				progress.value = withTiming(1, DRAWER_TIMING);
			},
		}),
		[progress, props.navigation],
	);

	function close() {
		setIsOpen(false);
		progress.value = withTiming(0, DRAWER_TIMING);
	}

	function navigate(item: NavigationItem) {
		close();
		props.navigation.navigate(item);
	}

	function selectWorkspace(slug: string) {
		close();
		setSheet(null);
		props.navigation.selectWorkspace(slug);
	}

	return (
		<WorkspaceDrawerContext.Provider value={drawerValue}>
			<View className="flex-1 bg-bg">
				<Animated.View className="flex-1" style={contentStyle}>
					{props.children}
				</Animated.View>
				<Animated.View
					style={scrimStyle}
					pointerEvents={isOpen ? "auto" : "none"}
					className={clsx("absolute inset-0 z-30 bg-overlay", DRAWER_WEB_HIDDEN)}
				>
					<Pressable
						onPress={close}
						className="flex-1"
						accessibilityRole="button"
						accessibilityLabel="Close navigation"
					/>
				</Animated.View>
				<Animated.View
					className={clsx(
						"absolute inset-y-0 left-0 z-40 border-r border-border bg-surface",
						DRAWER_WEB_HIDDEN,
					)}
					style={[
						drawerStyle,
						{ width: drawerWidth, paddingTop: insets.top, paddingBottom: insets.bottom },
					]}
				>
					<Sidebar
						className="flex-1"
						showSearch={false}
						onNavigate={navigate}
						items={props.navigation.items}
						key={props.navigation.workspace.slug}
						activeKey={props.navigation.activeKey}
						workspace={props.navigation.workspace}
						accountName={props.navigation.accountName}
						accountEmail={props.navigation.accountEmail}
						onWorkspaceOpen={() => setSheet("workspace")}
					/>
				</Animated.View>
				{sheet !== null && (
					<View pointerEvents="box-none" className="absolute inset-0 z-50">
						<WorkspaceSheet
							onSelect={selectWorkspace}
							data={props.navigation.data}
							items={props.navigation.items}
							onClose={() => setSheet(null)}
							currentWorkspaceSlug={props.navigation.workspace.slug}
						/>
					</View>
				)}
			</View>
		</WorkspaceDrawerContext.Provider>
	);
}
