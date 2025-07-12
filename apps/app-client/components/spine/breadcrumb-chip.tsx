import { useAtomValue, useSetAtom } from "jotai";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
	activeSubItemAtom,
	activeTrackerIdAtom,
	searchOpenAtom,
	trackersAtom,
} from "@/lib/navigation";
import { C, F } from "@/lib/theme";

export function BreadcrumbChip() {
	const trackers = useAtomValue(trackersAtom);
	const activeTrackerId = useAtomValue(activeTrackerIdAtom);
	const activeSubItem = useAtomValue(activeSubItemAtom);
	const setSearchOpen = useSetAtom(searchOpenAtom);

	const activeTracker = trackers.find((t) => t.id === activeTrackerId);
	if (!activeTracker) {
		return null;
	}

	return (
		<Pressable
			style={styles.chip}
			accessibilityRole="button"
			onPress={() => setSearchOpen(true)}
			accessibilityLabel={`Current location: ${activeTracker.name}${activeSubItem ? ` › ${activeSubItem}` : ""}. Tap to search.`}
		>
			<View style={styles.dot} />
			<Text style={styles.trackerName}>{activeTracker.name}</Text>
			{activeSubItem != null && (
				<>
					<Text style={styles.chevron}>›</Text>
					<Text style={styles.subItemText}>{activeSubItem}</Text>
				</>
			)}
		</Pressable>
	);
}

const styles = StyleSheet.create({
	chip: {
		gap: 8,
		paddingLeft: 8,
		paddingRight: 12,
		borderRadius: 14,
		borderWidth: 0.5,
		paddingVertical: 5,
		flexDirection: "row",
		borderColor: C.rule,
		alignItems: "center",
		alignSelf: "flex-start",
		backgroundColor: C.paperDeep,
	},
	dot: {
		width: 6,
		height: 6,
		borderRadius: 3,
		backgroundColor: C.accent,
	},
	trackerName: {
		fontSize: 11,
		color: C.ink,
		letterSpacing: 0.3,
		fontFamily: F.sansMedium,
	},
	chevron: {
		fontSize: 11,
		opacity: 0.4,
		color: C.inkSoft,
		fontFamily: F.sans,
	},
	subItemText: {
		fontSize: 12,
		color: C.inkSoft,
		fontFamily: F.serifItalic,
	},
});
