import dayjs from "dayjs";
import { useAtomValue } from "jotai";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PageHeader } from "@/components/spine/page-header";
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
		<PageHeader
			title={today.format("dddd")}
			eyebrow={`Today · ${today.format("DD MMM")}`}
		>
			<View style={styles.cards}>
				<View style={[styles.card, { opacity: 1 }]} />
				<View style={[styles.card, { opacity: 0.7 }]} />
				<View style={[styles.card, { opacity: 0.5 }]} />
			</View>
		</PageHeader>
	);
}

const styles = StyleSheet.create({
	emptySafe: { flex: 1 },
	cards: { gap: 14, marginTop: 16 },
	emptyRoot: { flex: 1, backgroundColor: C.paper },
	card: { height: 100, backgroundColor: C.paperDeep },
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
