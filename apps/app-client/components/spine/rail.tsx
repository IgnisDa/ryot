import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import Animated, {
	useAnimatedStyle,
	withSpring,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import type { Tracker } from "@/lib/navigation";
import {
	activeSubItemAtom,
	activeTrackerIdAtom,
	subFlyoutOpenAtom,
	trackersAtom,
} from "@/lib/navigation";
import { C, F } from "@/lib/theme";

export const RAIL_WIDTH = 168;
export const SPRING_CONFIG = { damping: 22, stiffness: 280 };

type Props = {
	translateX?: SharedValue<number>;
	onClose: () => void;
	pinned?: boolean;
};

export function SpineRail({ translateX, onClose, pinned = false }: Props) {
	const trackers = useAtomValue(trackersAtom);
	const [activeTrackerId, setActiveTrackerId] = useAtom(activeTrackerIdAtom);
	const setActiveSubItem = useSetAtom(activeSubItemAtom);
	const [subFlyoutOpen, setSubFlyoutOpen] = useAtom(subFlyoutOpenAtom);

	const railStyle = useAnimatedStyle(() => ({
		transform: [{ translateX: translateX?.value ?? 0 }],
	}));

	function handleTrackerPress(tracker: Tracker) {
		if (tracker.subItems?.length) {
			if (activeTrackerId === tracker.id && subFlyoutOpen) {
				setSubFlyoutOpen(false);
			} else {
				setActiveTrackerId(tracker.id);
				setSubFlyoutOpen(true);
			}
		} else {
			setActiveTrackerId(tracker.id);
			setActiveSubItem(null);
			setSubFlyoutOpen(false);
			if (!pinned && translateX) {
				translateX.value = withSpring(RAIL_WIDTH, SPRING_CONFIG, () => {
					scheduleOnRN(onClose);
				});
			}
		}
	}

	const items = (
		<ScrollView
			contentContainerStyle={styles.itemsContainer}
			showsVerticalScrollIndicator={false}
		>
			{trackers.map((tracker) => {
				const isActive = tracker.id === activeTrackerId;
				return (
					<Pressable
						key={tracker.id}
						style={styles.item}
						accessibilityRole="button"
						accessibilityLabel={tracker.name}
						onPress={() => handleTrackerPress(tracker)}
					>
						{isActive && <View style={styles.activeBar} />}
						<Text
							style={[
								styles.itemText,
								isActive ? styles.itemTextActive : styles.itemTextInactive,
							]}
						>
							{tracker.name}
						</Text>
						{tracker.subItems?.length ? (
							<Text style={styles.subItemChevron}>›</Text>
						) : null}
					</Pressable>
				);
			})}
		</ScrollView>
	);

	if (pinned) {
		return (
			<View style={styles.railPinned}>
				{items}
				<View style={styles.bindingLine} pointerEvents="none" />
			</View>
		);
	}

	return (
		<Animated.View style={[styles.rail, railStyle]}>
			{items}
			<View style={styles.bindingLine} pointerEvents="none" />
		</Animated.View>
	);
}

const styles = StyleSheet.create({
	rail: {
		top: 0,
		right: 0,
		bottom: 0,
		zIndex: 30,
		elevation: 12,
		shadowRadius: 24,
		width: RAIL_WIDTH,
		shadowColor: "#000",
		shadowOpacity: 0.12,
		position: "absolute",
		borderLeftWidth: 0.5,
		borderLeftColor: C.rule,
		backgroundColor: C.paperDeep,
		shadowOffset: { width: -8, height: 0 },
	},
	railPinned: {
		width: RAIL_WIDTH,
		borderLeftWidth: 0.5,
		borderLeftColor: C.rule,
		backgroundColor: C.paperDeep,
	},
	itemsContainer: {
		gap: 4,
		paddingTop: 64,
		flexWrap: "wrap",
		paddingBottom: 80,
		flexDirection: "row",
		paddingHorizontal: 16,
	},
	item: {
		minHeight: 44,
		paddingVertical: 10,
		flexDirection: "row",
		alignItems: "center",
		paddingHorizontal: 8,
		position: "relative",
	},
	activeBar: {
		top: 8,
		left: 0,
		width: 3,
		bottom: 8,
		position: "absolute",
		backgroundColor: C.accent,
	},
	itemText: { fontSize: 17, letterSpacing: 0.2 },
	itemTextActive: { color: C.ink, fontFamily: F.serifMediumItalic },
	itemTextInactive: { color: C.inkSoft, fontFamily: F.serif },
	subItemChevron: {
		fontSize: 14,
		opacity: 0.6,
		marginLeft: 4,
		color: C.inkMid,
		fontFamily: F.sans,
	},
	bindingLine: {
		top: 0,
		left: 0,
		width: 1,
		bottom: 0,
		opacity: 0.08,
		position: "absolute",
		backgroundColor: C.ink,
	},
});
