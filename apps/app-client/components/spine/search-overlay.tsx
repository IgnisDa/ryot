import { useSetAtom } from "jotai";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { SlideInDown, SlideOutUp } from "react-native-reanimated";
import { searchOpenAtom } from "@/lib/navigation";
import { C, F } from "@/lib/theme";

// TODO: wire query string to the search API
const MOCK_RESULTS = [
	{ title: "Lagavulin 16", kind: "Whiskey" },
	{ title: "Lagavulin Distillery", kind: "Places" },
	{ title: "Lagavulin tasting · Mar 4", kind: "Event" },
];

export function SearchOverlay() {
	const setSearchOpen = useSetAtom(searchOpenAtom);

	return (
		<Animated.View
			style={styles.overlay}
			exiting={SlideOutUp.duration(180)}
			entering={SlideInDown.duration(220)}
		>
			<Text style={styles.label}>Search · all entities</Text>
			<View style={styles.inputRow}>
				<TextInput
					autoFocus
					style={styles.input}
					placeholder="Search…"
					returnKeyType="search"
					placeholderTextColor={C.inkMid}
				/>
			</View>
			<View style={styles.results}>
				{MOCK_RESULTS.map((r) => (
					<Pressable key={r.title} style={styles.result}>
						<Text style={styles.resultTitle}>{r.title}</Text>
						<Text style={styles.resultKind}>{r.kind}</Text>
					</Pressable>
				))}
			</View>
			<Pressable
				style={styles.dismiss}
				accessibilityLabel="Dismiss search"
				onPress={() => setSearchOpen(false)}
			/>
		</Animated.View>
	);
}

const styles = StyleSheet.create({
	overlay: {
		top: 56,
		left: 0,
		right: 4,
		zIndex: 40,
		paddingTop: 24,
		paddingBottom: 20,
		position: "absolute",
		paddingHorizontal: 28,
		borderBottomWidth: 0.5,
		backgroundColor: C.paper,
		borderBottomColor: C.rule,
	},
	label: {
		fontSize: 10,
		letterSpacing: 2,
		marginBottom: 10,
		color: C.inkSoft,
		fontFamily: F.sans,
		textTransform: "uppercase",
	},
	result: { gap: 2 },
	results: { gap: 14, marginTop: 28 },
	inputRow: { flexDirection: "row", alignItems: "center" },
	resultTitle: { fontSize: 18, color: C.ink, fontFamily: F.serif },
	input: { flex: 1, fontSize: 28, color: C.ink, fontFamily: F.serif },
	resultKind: {
		fontSize: 11,
		color: C.inkSoft,
		fontFamily: F.sans,
		letterSpacing: 1.5,
		textTransform: "uppercase",
	},
	dismiss: {
		left: 0,
		right: 0,
		top: "100%",
		height: 9999,
		position: "absolute",
	},
});
