import { useLocalSearchParams } from "expo-router";

import { gridStyles, PageHeader } from "@/components/shell/page-header";
import { Box } from "@/components/ui/box";
import { useNavigationData } from "@/lib/navigation";

export default function TrackerScreen() {
	const { trackerSlug } = useLocalSearchParams<{ trackerSlug: string }>();
	const { trackers } = useNavigationData();
	const name = trackers.find((t) => t.slug === trackerSlug)?.name ?? trackerSlug;

	return (
		<PageHeader eyebrow={name} title="Entries">
			<Box className={gridStyles.grid}>
				{Array.from({ length: 6 }).map((_, i) => (
					<Box
						key={`skeleton-${i}`}
						className={gridStyles.card}
						style={{ opacity: 0.85 - i * 0.08 }}
					/>
				))}
			</Box>
		</PageHeader>
	);
}
