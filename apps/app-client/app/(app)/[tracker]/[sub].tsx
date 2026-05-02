import { useLocalSearchParams } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BreadcrumbChip } from "@/components/spine";
import { C, F } from "@/lib/theme";

export default function SubItemScreen() {
	const { tracker, sub } = useLocalSearchParams<{
		sub: string;
		tracker: string;
	}>();

	return (
		<View style={styles.root}>
			<ScrollView
				contentContainerStyle={styles.scrollContent}
				showsVerticalScrollIndicator={false}
			>
				<SafeAreaView>
					<BreadcrumbChip />
					<Text style={styles.eyebrow}>
						{tracker} · {sub}
					</Text>
					<Text style={styles.title}>Entries</Text>
					<View style={styles.rule} />
					<View style={styles.grid}>
						{Array.from({ length: 6 }).map((_, i) => (
							<View
								key={i}
								style={[styles.card, { opacity: 0.85 - i * 0.08 }]}
							/>
						))}
					</View>
				</SafeAreaView>
			</ScrollView>
		</View>
	);
}

const styles = StyleSheet.create({
	root: { flex: 1, backgroundColor: C.paper },
	rule: { height: 0.5, marginTop: 18, backgroundColor: C.rule },
	card: { width: "46%", aspectRatio: 2 / 3, backgroundColor: C.paperDeep },
	scrollContent: { paddingTop: 110, paddingBottom: 40, paddingHorizontal: 28 },
	grid: {
		gap: 12,
		marginTop: 16,
		flexWrap: "wrap",
		flexDirection: "row",
	},
	eyebrow: {
		fontSize: 10,
		marginTop: 14,
		letterSpacing: 2,
		color: C.inkSoft,
		fontFamily: F.sans,
		textTransform: "uppercase",
	},
	title: {
		color: C.ink,
		fontSize: 38,
		marginTop: 4,
		lineHeight: 40,
		fontWeight: "400",
		fontFamily: F.serif,
		letterSpacing: -0.5,
	},
});
