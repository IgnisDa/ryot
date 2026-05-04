import { useLocalSearchParams } from "expo-router";
import { gridStyles, PageHeader } from "@/components/spine/page-header";
import { Box } from "@/components/ui/box";
import { useNavigationData } from "@/lib/navigation";

export default function SubItemScreen() {
	const { trackerSlug, viewSlug } = useLocalSearchParams<{
		viewSlug: string;
		trackerSlug: string;
	}>();
	const { trackers } = useNavigationData();
	const trackerName =
		trackers.find((t) => t.slug === trackerSlug)?.name ?? trackerSlug;
	const subItem = trackers
		.find((t) => t.slug === trackerSlug)
		?.subItems.find((s) => s.slug === viewSlug);
	const viewName = subItem?.name ?? viewSlug;

	return (
		<PageHeader eyebrow={`${trackerName} · ${viewName}`} title="Entries">
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
