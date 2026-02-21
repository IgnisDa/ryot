import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { gridStyles, PageHeader } from "@/components/spine/page-header";

export default function SubItemScreen() {
	const { tracker, sub } = useLocalSearchParams<{
		sub: string;
		tracker: string;
	}>();

	return (
		<PageHeader eyebrow={`${tracker} · ${sub}`} title="Entries">
			<View style={gridStyles.grid}>
				{Array.from({ length: 6 }).map((_, i) => (
					<View
						key={i}
						style={[gridStyles.card, { opacity: 0.85 - i * 0.08 }]}
					/>
				))}
			</View>
		</PageHeader>
	);
}
