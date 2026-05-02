import { useAtom, useAtomValue } from "jotai";
import type { ReactNode } from "react";
import { useCallback } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
	useAnimatedStyle,
	useSharedValue,
	withSpring,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
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

const EDGE_HIT_ZONE = 44;
const SNAP_THRESHOLD = 80;
const TABLET_BREAKPOINT = 768;

type Props = { children: ReactNode };

export function SpineNavigation({ children }: Props) {
	const { width: screenWidth } = useWindowDimensions();
	const trackers = useAtomValue(trackersAtom);
	const [, setRailOpen] = useAtom(railOpenAtom);
	const [subFlyoutOpen, setSubFlyoutOpen] = useAtom(subFlyoutOpenAtom);
	const searchOpen = useAtomValue(searchOpenAtom);

	const isTablet = screenWidth >= TABLET_BREAKPOINT;

	// Open = 0 (rail at right:0, fully visible). Closed = RAIL_WIDTH (pushed off-screen right).
	const translateX = useSharedValue(isTablet ? 0 : RAIL_WIDTH);
	const isFromEdge = useSharedValue(false);
	const gestureBlocked = useSharedValue(false);

	const openRail = useCallback(() => setRailOpen(true), [setRailOpen]);

	const closeRail = useCallback(() => {
		setRailOpen(false);
		setSubFlyoutOpen(false);
	}, [setRailOpen, setSubFlyoutOpen]);

	const handleDismiss = useCallback(() => {
		gestureBlocked.value = true;
		translateX.value = withSpring(RAIL_WIDTH, SPRING_CONFIG, () => {
			scheduleOnRN(closeRail);
			gestureBlocked.value = false;
		});
	}, [translateX, gestureBlocked, closeRail]);

	// Activate only on leftward swipes (translationX < -10).
	const panGesture = Gesture.Pan()
		.activeOffsetX([-10, 10000])
		.onBegin((e) => {
			"worklet";
			// Rail is open when translateX ≈ 0; closed when ≈ RAIL_WIDTH.
			const railIsOpen = translateX.value < RAIL_WIDTH - 8;
			isFromEdge.value =
				railIsOpen || e.absoluteX > screenWidth - EDGE_HIT_ZONE;
		})
		.onUpdate((e) => {
			"worklet";
			if (!isFromEdge.value || gestureBlocked.value) {
				return;
			}
			// translationX is negative (leftward swipe); map to rail position.
			translateX.value = Math.min(
				RAIL_WIDTH,
				Math.max(0, RAIL_WIDTH + e.translationX),
			);
		})
		.onEnd((e) => {
			"worklet";
			if (!isFromEdge.value || gestureBlocked.value) {
				return;
			}
			const shouldOpen =
				translateX.value < SNAP_THRESHOLD || e.velocityX < -400;
			if (shouldOpen) {
				translateX.value = withSpring(0, SPRING_CONFIG, () => {
					scheduleOnRN(openRail);
				});
			} else {
				translateX.value = withSpring(RAIL_WIDTH, SPRING_CONFIG, () => {
					scheduleOnRN(closeRail);
				});
			}
		});

	// Dim scales 0 (closed) → 0.22 (open).
	const dimStyle = useAnimatedStyle(() => ({
		opacity: ((RAIL_WIDTH - translateX.value) / RAIL_WIDTH) * 0.22,
	}));

	if (!trackers.length) {
		return <>{children}</>;
	}

	if (isTablet) {
		return (
			<View style={styles.row}>
				<View style={styles.content}>{children}</View>
				{subFlyoutOpen && (
					<SpineSubFlyout pinned onNavigate={() => setSubFlyoutOpen(false)} />
				)}
				<SpineRail pinned onClose={closeRail} />
			</View>
		);
	}

	return (
		<View style={styles.fill}>
			{children}
			<GestureDetector gesture={panGesture}>
				<View style={styles.overlay} pointerEvents="box-none">
					<Animated.View style={[styles.dim, dimStyle]} pointerEvents="auto">
						<Pressable
							style={StyleSheet.absoluteFill}
							onPress={handleDismiss}
							accessibilityLabel="Close navigation"
						/>
					</Animated.View>

					{subFlyoutOpen && <SpineSubFlyout onNavigate={handleDismiss} />}

					<SpineRail translateX={translateX} onClose={closeRail} />
					<SpineHairline railTranslateX={translateX} />

					{searchOpen && <SearchOverlay />}
				</View>
			</GestureDetector>
		</View>
	);
}

export { BreadcrumbChip } from "./breadcrumb-chip";

const styles = StyleSheet.create({
	fill: { flex: 1 },
	content: { flex: 1 },
	row: { flex: 1, flexDirection: "row" },
	overlay: { ...StyleSheet.absoluteFill, zIndex: 20 },
	dim: { ...StyleSheet.absoluteFill, zIndex: 12, backgroundColor: C.ink },
});
