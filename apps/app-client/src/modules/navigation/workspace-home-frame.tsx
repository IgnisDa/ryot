import clsx from "clsx";
import { useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppIcon as NavigationIcon } from "@/modules/icons";

import { useWorkspaceDrawer } from "./workspace-drawer";

const TOP_BAR_GAP = 12;
const TOP_BAR_HEIGHT = 57;
const TOP_BAR_WEB_HIDDEN = Platform.OS === "web" ? "md:hidden" : null;
const TOP_BAR_EXITING = FadeOutUp.duration(160).reduceMotion(ReduceMotion.System);
const TOP_BAR_ENTERING = FadeInUp.duration(200).reduceMotion(ReduceMotion.System);

function WorkspaceTopBar(props: { onMenuOpen: () => void }) {
	return (
		<View className="flex-row items-center gap-3 py-2">
			<Pressable
				onPress={props.onMenuOpen}
				accessibilityRole="button"
				accessibilityLabel="Open navigation"
				className="h-10 w-10 items-center justify-center rounded-pill border border-border-strong bg-surface-2"
			>
				<NavigationIcon className="text-text-muted" name="menu" size={24} />
			</Pressable>
			<View className="h-10 flex-1 flex-row items-center gap-2 rounded-pill border border-border-strong bg-surface-2 px-3.5">
				<NavigationIcon className="text-text-muted" name="search" size={24} />
				<Text className="font-ui text-sm text-text-subtle">Search</Text>
			</View>
		</View>
	);
}

export function WorkspaceHomeFrame(props: { children: ReactNode }) {
	const insets = useSafeAreaInsets();
	const drawer = useWorkspaceDrawer();
	const isDragging = useRef(false);
	const previousScrollOffset = useRef(0);
	const [isScrolled, setIsScrolled] = useState(false);

	return (
		<View className="relative flex-1 bg-bg">
			<ScrollView
				className="flex-1"
				scrollEventThrottle={16}
				contentContainerClassName="min-h-full px-4 pb-8 md:px-8 md:pt-8"
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
					className={clsx(TOP_BAR_WEB_HIDDEN)}
					style={{ height: insets.top + TOP_BAR_HEIGHT + TOP_BAR_GAP }}
				/>
				{props.children}
			</ScrollView>
			{!isScrolled && (
				<Animated.View
					exiting={TOP_BAR_EXITING}
					entering={TOP_BAR_ENTERING}
					style={{ paddingTop: insets.top }}
					className={clsx(
						"absolute inset-x-0 top-0 z-20 border-b border-border bg-bg px-4",
						TOP_BAR_WEB_HIDDEN,
					)}
				>
					<WorkspaceTopBar onMenuOpen={drawer.openDrawer} />
				</Animated.View>
			)}
		</View>
	);
}
