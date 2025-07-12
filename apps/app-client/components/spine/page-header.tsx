import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BreadcrumbChip } from "@/components/spine/breadcrumb-chip";
import { C, F } from "@/lib/theme";

type Props = {
	eyebrow: string;
	title: string;
	children?: ReactNode;
};

export function PageHeader({ eyebrow, title, children }: Props) {
	return (
		<View style={styles.root}>
			<ScrollView
				showsVerticalScrollIndicator={false}
				contentContainerStyle={styles.scrollContent}
			>
				<SafeAreaView>
					<BreadcrumbChip />
					<Text style={styles.eyebrow}>{eyebrow}</Text>
					<Text style={styles.title}>{title}</Text>
					<View style={styles.rule} />
					{children}
				</SafeAreaView>
			</ScrollView>
		</View>
	);
}

export const gridStyles = StyleSheet.create({
	grid: { gap: 12, marginTop: 16, flexWrap: "wrap", flexDirection: "row" },
	card: { width: "46%", aspectRatio: 2 / 3, backgroundColor: C.paperDeep },
});

const styles = StyleSheet.create({
	root: { flex: 1, backgroundColor: C.paper },
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
});
