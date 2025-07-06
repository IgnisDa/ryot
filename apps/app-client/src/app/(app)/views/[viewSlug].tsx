import { useLocalSearchParams } from "expo-router";
import { gridStyles, PageHeader } from "@/components/shell/page-header";
import { Box } from "@/components/ui/box";
import { useNavigationData } from "@/lib/navigation";

export default function ViewScreen() {
	const { viewSlug } = useLocalSearchParams<{ viewSlug: string }>();
	const { trackers } = useNavigationData();
	const subItem = trackers
		.flatMap((t) => t.subItems)
		.find((s) => s.slug === viewSlug);
	const viewName = subItem?.name ?? viewSlug;

	return (
		<PageHeader eyebrow={viewName} title="Entries">
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
