import { useRef, useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ReadyWorkspaceNavigation } from "./use-workspace-navigation";
import { MobileAccountSheet, MobileTopBar, MobileWorkspaceSheet } from "./workspace-shell";

const TOP_BAR_GAP = 12;
const TOP_BAR_HEIGHT = 57;
const TOP_BAR_EXITING = FadeOutUp.duration(160).reduceMotion(ReduceMotion.System);
const TOP_BAR_ENTERING = FadeInUp.duration(200).reduceMotion(ReduceMotion.System);

export function MobileWorkspaceFrame(props: {
	topInset?: number;
	children: ReactNode;
	navigation: ReadyWorkspaceNavigation;
}) {
	const insets = useSafeAreaInsets();
	const topInset = props.topInset ?? insets.top;
	const [sheet, setSheet] = useState<"workspace" | "account" | null>(null);
	const [isScrolled, setIsScrolled] = useState(false);
	const isDragging = useRef(false);
	const previousScrollOffset = useRef(0);

	return (
		<View className="relative flex-1 bg-bg">
			<ScrollView
				className="flex-1"
				scrollEventThrottle={16}
				contentContainerClassName="min-h-full px-4 pb-8"
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
				<View style={{ height: topInset + TOP_BAR_HEIGHT + TOP_BAR_GAP }} />
				{props.children}
			</ScrollView>
			{!isScrolled && (
				<Animated.View
					exiting={TOP_BAR_EXITING}
					entering={TOP_BAR_ENTERING}
					style={{ paddingTop: topInset }}
					className="absolute inset-x-0 top-0 z-20 border-b border-border bg-bg px-4"
				>
					<MobileTopBar
						workspaceIcon={props.navigation.workspace.icon}
						workspaceName={props.navigation.workspace.name}
						onAccountOpen={() => setSheet("account")}
						onWorkspaceOpen={() => setSheet("workspace")}
					/>
				</Animated.View>
			)}
			{sheet === "workspace" && (
				<MobileWorkspaceSheet
					data={props.navigation.data}
					items={props.navigation.items}
					onClose={() => setSheet(null)}
					onSelect={(slug) => {
						setSheet(null);
						props.navigation.selectWorkspace(slug);
					}}
					currentWorkspaceSlug={props.navigation.workspace.slug}
				/>
			)}
			{sheet === "account" && (
				<MobileAccountSheet
					onClose={() => setSheet(null)}
					accountName={props.navigation.accountName}
					accountEmail={props.navigation.accountEmail}
				/>
			)}
		</View>
	);
}
