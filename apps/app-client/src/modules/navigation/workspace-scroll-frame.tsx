import clsx from "clsx";
import { useRef, useState, type ReactNode } from "react";
import { Platform, ScrollView, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const MOBILE_ONLY = Platform.OS === "web" ? "md:hidden" : null;
const HEADER_EXITING = FadeOutUp.duration(160).reduceMotion(ReduceMotion.System);
const HEADER_ENTERING = FadeInUp.duration(200).reduceMotion(ReduceMotion.System);

export function WorkspaceScrollFrame(props: {
	header: ReactNode;
	children: ReactNode;
	headerHeight: number;
	headerClassName?: string;
	contentContainerClassName?: string;
}) {
	const insets = useSafeAreaInsets();
	const isDragging = useRef(false);
	const previousScrollOffset = useRef(0);
	const [isScrolled, setIsScrolled] = useState(false);

	return (
		<View className="relative flex-1 bg-bg">
			<ScrollView
				className="flex-1"
				scrollEventThrottle={16}
				contentContainerClassName={clsx(
					"min-h-full px-4 pb-8 md:px-8 md:pt-8",
					props.contentContainerClassName,
				)}
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
				<View className={clsx(MOBILE_ONLY)} style={{ height: insets.top + props.headerHeight }} />
				{props.children}
			</ScrollView>
			{!isScrolled && (
				<Animated.View
					exiting={HEADER_EXITING}
					entering={HEADER_ENTERING}
					style={{ paddingTop: insets.top }}
					className={clsx(
						"absolute inset-x-0 top-0 z-20 bg-bg",
						MOBILE_ONLY,
						props.headerClassName,
					)}
				>
					{props.header}
				</Animated.View>
			)}
		</View>
	);
}
