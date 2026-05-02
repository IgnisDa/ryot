import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { SlideInRight, SlideOutRight } from "react-native-reanimated";
import {
	activeSubItemAtom,
	activeTrackerIdAtom,
	subFlyoutOpenAtom,
	trackersAtom,
} from "@/lib/navigation";
import { C, F } from "@/lib/theme";
import { RAIL_WIDTH } from "./rail";

export const FLYOUT_WIDTH = 220;

type Props = {
	onNavigate: () => void;
	pinned?: boolean;
};

export function SpineSubFlyout({ onNavigate, pinned = false }: Props) {
	const trackers = useAtomValue(trackersAtom);
	const activeTrackerId = useAtomValue(activeTrackerIdAtom);
	const [activeSubItem, setActiveSubItem] = useAtom(activeSubItemAtom);
	const setSubFlyoutOpen = useSetAtom(subFlyoutOpenAtom);

	const activeTracker = trackers.find((t) => t.id === activeTrackerId);
	const subItems = activeTracker?.subItems ?? [];

	if (!subItems.length) {
		return null;
	}

	function handleSubItemPress(item: string) {
		setActiveSubItem(item);
		setSubFlyoutOpen(false);
		onNavigate();
	}

	const content = (
		<>
			<Text style={styles.header}>
				{activeTracker?.name} · {subItems.length} schemas
			</Text>
			<View style={styles.itemsContainer}>
				{subItems.map((item) => {
					const isActive = item === activeSubItem;
					return (
						<Pressable
							key={item}
							style={styles.item}
							accessibilityLabel={item}
							accessibilityRole="button"
							onPress={() => handleSubItemPress(item)}
						>
							<Text
								style={[
									styles.itemText,
									isActive ? styles.itemTextActive : styles.itemTextInactive,
								]}
							>
								{item}
							</Text>
						</Pressable>
					);
				})}
			</View>
			<View style={styles.separator} />
			<Text style={styles.addSchema}>＋ new schema</Text>
		</>
	);

	if (pinned) {
		return <View style={styles.flyoutPinned}>{content}</View>;
	}

	return (
		<Animated.View
			style={styles.flyout}
			entering={SlideInRight.duration(220)}
			exiting={SlideOutRight.duration(180)}
		>
			{content}
		</Animated.View>
	);
}

const styles = StyleSheet.create({
	flyout: {
		top: 0,
		bottom: 0,
		zIndex: 25,
		elevation: 10,
		paddingTop: 64,
		shadowRadius: 24,
		right: RAIL_WIDTH,
		paddingBottom: 80,
		shadowOpacity: 0.12,
		width: FLYOUT_WIDTH,
		shadowColor: "#000",
		position: "absolute",
		backgroundColor: C.paper,
		shadowOffset: { width: -8, height: 0 },
	},
	flyoutPinned: {
		width: FLYOUT_WIDTH,
		paddingTop: 64,
		paddingBottom: 80,
		borderLeftWidth: 0.5,
		borderLeftColor: C.rule,
		backgroundColor: C.paper,
	},
	header: {
		fontSize: 10,
		color: C.inkSoft,
		letterSpacing: 2,
		paddingBottom: 14,
		fontFamily: F.sans,
		paddingHorizontal: 24,
		textTransform: "uppercase",
	},
	itemsContainer: {
		gap: 4,
		flexWrap: "wrap",
		flexDirection: "row",
		paddingHorizontal: 16,
	},
	item: {
		minHeight: 44,
		paddingVertical: 8,
		paddingHorizontal: 8,
		justifyContent: "center",
	},
	itemText: { fontSize: 18 },
	itemTextInactive: { color: C.ink, fontFamily: F.serif },
	itemTextActive: { color: C.accent, fontFamily: F.serifMediumItalic },
	separator: {
		height: 0.5,
		marginTop: 14,
		marginBottom: 14,
		marginHorizontal: 24,
		backgroundColor: C.rule,
	},
	addSchema: {
		fontSize: 12,
		color: C.inkSoft,
		fontFamily: F.sans,
		paddingHorizontal: 24,
	},
});
