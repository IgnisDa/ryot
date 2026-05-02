import { useLocalSearchParams } from "expo-router";
import { useAtomValue } from "jotai";
import { View } from "react-native";
import { gridStyles, PageHeader } from "@/components/spine/page-header";
import { trackersAtom } from "@/lib/navigation";

export default function TrackerScreen() {
	const { tracker: trackerId } = useLocalSearchParams<{ tracker: string }>();
	const trackers = useAtomValue(trackersAtom);
	const name = trackers.find((t) => t.id === trackerId)?.name ?? trackerId;

	return (
		<PageHeader eyebrow={name} title="Entries">
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
