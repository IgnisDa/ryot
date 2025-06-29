import { useLocalSearchParams } from "expo-router";
import { useAtomValue } from "jotai";
import { gridStyles, PageHeader } from "@/components/spine/page-header";
import { Box } from "@/components/ui/box";
import { trackersAtom } from "@/lib/navigation";

export default function TrackerScreen() {
	const { tracker: trackerId } = useLocalSearchParams<{ tracker: string }>();
	const trackers = useAtomValue(trackersAtom);
	const name = trackers.find((t) => t.id === trackerId)?.name ?? trackerId;

	return (
		<PageHeader eyebrow={name} title="Entries">
			<Box className={gridStyles.grid}>
				{Array.from({ length: 6 }).map((_, i) => (
					<Box
						key={i}
						className={gridStyles.card}
						style={{ opacity: 0.85 - i * 0.08 }}
					/>
				))}
			</Box>
		</PageHeader>
	);
}
