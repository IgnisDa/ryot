import { useLocalSearchParams } from "expo-router";

import { gridStyles, PageHeader } from "@/components/shell/page-header";
import { Box } from "@/components/ui/box";
import { MediaTrackerOverview } from "@/features/media/overview";
import { useNavigationData } from "@/lib/navigation";

export default function TrackerScreen() {
	const { trackers } = useNavigationData();
	const { trackerSlug } = useLocalSearchParams<"/(app)/tracker/[trackerSlug]">();

	if (trackerSlug === "media") {
		return <MediaTrackerOverview />;
	}

	const name = trackers.find((t) => t.slug === trackerSlug)?.name ?? trackerSlug;

	return (
		<PageHeader eyebrow={name} title="Entries">
			<Box className={gridStyles.grid}>
				{["one", "two", "three", "four", "five", "six"].map((skeletonKey, i) => (
					<Box key={skeletonKey} className={gridStyles.card} style={{ opacity: 0.85 - i * 0.08 }} />
				))}
			</Box>
		</PageHeader>
	);
}
