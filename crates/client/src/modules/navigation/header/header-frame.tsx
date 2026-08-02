import clsx from "clsx";
import { useRef, useState, type ReactNode } from "react";
import {
	PanResponder,
	Platform,
	Text,
	View,
	type NativeScrollEvent,
	type NativeSyntheticEvent,
} from "react-native";
import Animated, {
	useAnimatedRef,
	useAnimatedStyle,
	useScrollOffset,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
	compactTitleProgress,
	HEADER_LARGE_TITLE_HEIGHT,
	headerSurfaceProgress,
} from "./header-metrics";
import { useHeaderContentOffset } from "./use-header-content-offset";

const MOBILE_ONLY = Platform.OS === "web" ? "md:hidden" : null;

export function HeaderFrame(props: {
	title: string;
	hero?: ReactNode;
	meta?: ReactNode;
	leading: ReactNode;
	children: ReactNode;
	actions?: ReactNode;
	heroHeight?: number;
	searchRow?: ReactNode;
	hideLargeTitle?: boolean;
	initialScrollOffset?: number;
	onSearchEdgeSwipe?: () => void;
	onScrollOffsetChange?: (offset: number) => void;
}) {
	const insets = useSafeAreaInsets();
	const contentOffset = useHeaderContentOffset();
	const heroHeight = props.heroHeight ?? 0;
	const scrollRef = useAnimatedRef<Animated.ScrollView>();
	const scrollOffset = useScrollOffset(scrollRef);
	const restoredOffset = props.initialScrollOffset ?? 0;
	const isRestored = useRef(restoredOffset === 0);
	const [isScrollVisible, setIsScrollVisible] = useState(restoredOffset === 0);
	const searchEdgeSwipe = useRef(
		PanResponder.create({
			onMoveShouldSetPanResponder: (_event, gesture) =>
				gesture.dx > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
			onPanResponderRelease: (_event, gesture) => {
				if (gesture.dx > 24) {
					props.onSearchEdgeSwipe?.();
				}
			},
		}),
	).current;
	const surfaceStyle = useAnimatedStyle(() => ({
		opacity: headerSurfaceProgress(scrollOffset.value, heroHeight),
	}));
	const largeTitleStyle = useAnimatedStyle(() => ({
		opacity: 1 - compactTitleProgress(scrollOffset.value, heroHeight),
	}));
	const compactTitleStyle = useAnimatedStyle(() => {
		const progress = compactTitleProgress(scrollOffset.value, heroHeight);
		return { opacity: progress, transform: [{ translateY: (1 - progress) * 6 }] };
	});

	function reportOffset(event: NativeSyntheticEvent<NativeScrollEvent>) {
		props.onScrollOffsetChange?.(event.nativeEvent.contentOffset.y);
	}

	function restoreOffset() {
		if (isRestored.current) {
			return;
		}
		isRestored.current = true;
		scrollRef.current?.scrollTo({ y: restoredOffset, animated: false });
		setIsScrollVisible(true);
	}

	return (
		<View className="relative flex-1 bg-bg">
			<Animated.ScrollView
				ref={scrollRef}
				className="flex-1"
				scrollEventThrottle={16}
				onScrollEndDrag={reportOffset}
				onMomentumScrollEnd={reportOffset}
				onContentSizeChange={restoreOffset}
				style={{ opacity: isScrollVisible ? 1 : 0 }}
				onScroll={Platform.OS === "web" ? reportOffset : undefined}
				contentContainerClassName="min-h-full pb-8 md:px-8 md:pt-8"
			>
				{props.hero ?? <View className={clsx(MOBILE_ONLY)} style={{ height: contentOffset }} />}
				{props.searchRow || props.hideLargeTitle ? null : (
					<Animated.View
						style={largeTitleStyle}
						className={clsx("justify-center gap-1 px-4 pb-2", MOBILE_ONLY)}
					>
						<Text
							numberOfLines={2}
							style={{ minHeight: HEADER_LARGE_TITLE_HEIGHT - 20 }}
							className="font-display-semibold text-[30px] leading-9 text-text"
						>
							{props.title}
						</Text>
						{props.meta}
					</Animated.View>
				)}
				<View className="px-4 md:px-0">{props.children}</View>
			</Animated.ScrollView>
			<View className={clsx("absolute inset-x-0 top-0 z-20", MOBILE_ONLY)}>
				<Animated.View
					style={surfaceStyle}
					className="absolute inset-0 border-b border-border bg-bg"
				/>
				<View style={{ paddingTop: insets.top }}>
					{props.searchRow ?? (
						<View className="h-13.5 flex-row items-center gap-1.5 px-4">
							{props.leading}
							<Animated.View className="min-w-0 flex-1" style={compactTitleStyle}>
								<Text numberOfLines={1} className="font-ui-semibold text-[19px] text-text">
									{props.title}
								</Text>
							</Animated.View>
							{props.actions}
						</View>
					)}
				</View>
			</View>
			{Platform.OS === "ios" && props.searchRow && props.onSearchEdgeSwipe ? (
				<View
					style={{ width: 24 }}
					className="absolute inset-y-0 left-0 z-30"
					{...searchEdgeSwipe.panHandlers}
				/>
			) : null}
		</View>
	);
}
