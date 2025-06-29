import dayjs from "dayjs";
import { useAtomValue } from "jotai";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BreadcrumbChip } from "@/components/spine";
import { trackersAtom } from "@/lib/navigation";
import { C, F } from "@/lib/theme";

export default function HomeScreen() {
	const trackers = useAtomValue(trackersAtom);

	if (!trackers.length) {
		return (
			<View style={styles.emptyRoot}>
				<SafeAreaView style={styles.emptySafe}>
					<View style={styles.emptyContent}>
						<Text style={styles.emptyEyebrow}>Welcome</Text>
						<Text style={styles.emptyTitle}>{"Your journal\nis empty."}</Text>
						<Text style={styles.emptyBody}>
							Add your first tracker to start.{"\n"}Built-in: Media, Fitness. Or
							build your own.
						</Text>
						<Pressable style={styles.emptyCtaButton}>
							<Text style={styles.emptyCtaText}>＋ Add a tracker</Text>
						</Pressable>
					</View>
				</SafeAreaView>
			</View>
		);
	}

	const today = dayjs();

	return (
		<View style={styles.root}>
			<ScrollView
				contentContainerStyle={styles.scrollContent}
				showsVerticalScrollIndicator={false}
			>
				<SafeAreaView>
					<BreadcrumbChip />
					<Text style={styles.eyebrow}>Today · {today.format("DD MMM")}</Text>
					<Text style={styles.title}>{today.format("dddd")}</Text>
					<View style={styles.rule} />
					<View style={styles.cards}>
						<View style={[styles.card, { opacity: 1 }]} />
						<View style={[styles.card, { opacity: 0.7 }]} />
						<View style={[styles.card, { opacity: 0.5 }]} />
					</View>
				</SafeAreaView>
			</ScrollView>
		</View>
	);
}

const styles = StyleSheet.create({
	emptySafe: { flex: 1 },
	cards: { gap: 14, marginTop: 16 },
	root: { flex: 1, backgroundColor: C.paper },
	emptyRoot: { flex: 1, backgroundColor: C.paper },
	card: { height: 100, backgroundColor: C.paperDeep },
	rule: { height: 0.5, marginTop: 18, backgroundColor: C.rule },
	scrollContent: { paddingTop: 110, paddingBottom: 40, paddingHorizontal: 28 },
	eyebrow: {
		fontSize: 10,
		marginTop: 14,
		letterSpacing: 2,
		color: C.inkSoft,
		fontFamily: F.sans,
		textTransform: "uppercase",
	},
	title: {
		fontSize: 38,
		color: C.ink,
		marginTop: 4,
		lineHeight: 40,
		fontWeight: "400",
		fontFamily: F.serif,
		letterSpacing: -0.5,
	},
	emptyContent: {
		flex: 1,
		alignItems: "center",
		paddingHorizontal: 40,
		justifyContent: "center",
	},
	emptyEyebrow: {
		fontSize: 10,
		letterSpacing: 2,
		color: C.inkSoft,
		fontFamily: F.sans,
		textTransform: "uppercase",
	},
	emptyTitle: {
		fontSize: 32,
		color: C.ink,
		marginTop: 8,
		lineHeight: 36,
		textAlign: "center",
		letterSpacing: -0.5,
		fontFamily: F.serifItalic,
	},
	emptyBody: {
		fontSize: 15,
		marginTop: 18,
		lineHeight: 22,
		color: C.inkSoft,
		fontFamily: F.serif,
		textAlign: "center",
	},
	emptyCtaButton: {
		marginTop: 36,
		borderRadius: 4,
		paddingVertical: 12,
		flexDirection: "row",
		alignItems: "center",
		paddingHorizontal: 22,
		backgroundColor: C.ink,
	},
	emptyCtaText: {
		fontSize: 13,
		color: C.paper,
		letterSpacing: 0.3,
		fontFamily: F.sans,
	},
});
