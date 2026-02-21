import { useAtom, useAtomValue } from "jotai";
import { useCallback } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
	runOnJS,
	useAnimatedStyle,
	useSharedValue,
	withSpring,
} from "react-native-reanimated";
import {
	railOpenAtom,
	searchOpenAtom,
	subFlyoutOpenAtom,
	trackersAtom,
} from "@/lib/navigation";
import { C } from "@/lib/theme";
import { SpineHairline } from "./hairline";
import { RAIL_WIDTH, SPRING_CONFIG, SpineRail } from "./rail";
import { SearchOverlay } from "./search-overlay";
import { SpineSubFlyout } from "./sub-flyout";

const EDGE_HIT_ZONE = 28;
const SNAP_THRESHOLD = 80;
const TABLET_BREAKPOINT = 768;

export function SpineNavigation() {
	const { width: screenWidth } = useWindowDimensions();
	const trackers = useAtomValue(trackersAtom);
	const [railOpen, setRailOpen] = useAtom(railOpenAtom);
	const [subFlyoutOpen, setSubFlyoutOpen] = useAtom(subFlyoutOpenAtom);
	const searchOpen = useAtomValue(searchOpenAtom);

	const isTablet = screenWidth >= TABLET_BREAKPOINT;
	const translateX = useSharedValue(isTablet ? -RAIL_WIDTH : 0);
	const isFromEdge = useSharedValue(false);
	const gestureBlocked = useSharedValue(false);

	const openRail = useCallback(() => setRailOpen(true), [setRailOpen]);

	const closeRail = useCallback(() => {
		setRailOpen(false);
		setSubFlyoutOpen(false);
	}, [setRailOpen, setSubFlyoutOpen]);

	const handleDismiss = useCallback(() => {
		gestureBlocked.value = true;
		translateX.value = withSpring(0, SPRING_CONFIG, () => {
			runOnJS(closeRail)();
			gestureBlocked.value = false;
		});
	}, [translateX, gestureBlocked, closeRail]);

	const panGesture = Gesture.Pan()
		.activeOffsetX(-12)
		.onBegin((e) => {
			"worklet";
			isFromEdge.value = railOpen || e.absoluteX > screenWidth - EDGE_HIT_ZONE;
		})
		.onUpdate((e) => {
			"worklet";
			if (!isFromEdge.value || gestureBlocked.value) {
				return;
			}
			translateX.value = Math.max(-RAIL_WIDTH, Math.min(0, e.translationX));
		})
		.onEnd((e) => {
			"worklet";
			if (!isFromEdge.value || gestureBlocked.value) {
				return;
			}
			const shouldOpen =
				translateX.value < -SNAP_THRESHOLD || e.velocityX < -400;
			if (shouldOpen) {
				translateX.value = withSpring(-RAIL_WIDTH, SPRING_CONFIG, () => {
					runOnJS(openRail)();
				});
			} else {
				translateX.value = withSpring(0, SPRING_CONFIG, () => {
					runOnJS(closeRail)();
				});
			}
		});

	const dimStyle = useAnimatedStyle(() => ({
		opacity: (-translateX.value / RAIL_WIDTH) * 0.22,
	}));

	if (!trackers.length) {
		return null;
	}

	if (isTablet) {
		return (
			<View style={styles.overlay} pointerEvents="box-none">
				{subFlyoutOpen && (
					<SpineSubFlyout railTranslateX={translateX} onNavigate={closeRail} />
				)}
				<SpineRail translateX={translateX} onClose={closeRail} />
				{searchOpen && <SearchOverlay />}
			</View>
		);
	}

	return (
		<GestureDetector gesture={panGesture}>
			<View style={styles.overlay} pointerEvents="box-none">
				{railOpen && (
					<Animated.View style={[styles.dim, dimStyle]} pointerEvents="auto">
						<Pressable
							onPress={handleDismiss}
							style={StyleSheet.absoluteFill}
							accessibilityLabel="Close navigation"
						/>
					</Animated.View>
				)}

				{subFlyoutOpen && (
					<SpineSubFlyout
						onNavigate={handleDismiss}
						railTranslateX={translateX}
					/>
				)}

				<SpineRail translateX={translateX} onClose={closeRail} />
				<SpineHairline railTranslateX={translateX} />

				{searchOpen && <SearchOverlay />}
			</View>
		</GestureDetector>
	);
}

export { BreadcrumbChip } from "./breadcrumb-chip";

const styles = StyleSheet.create({
	overlay: { ...StyleSheet.absoluteFill, zIndex: 20 },
	dim: { ...StyleSheet.absoluteFill, zIndex: 12, backgroundColor: C.ink },
});
