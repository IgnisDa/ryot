import { useLocalSearchParams } from "expo-router";
import { gridStyles, PageHeader } from "@/components/spine/page-header";
import { Box } from "@/components/ui/box";

export default function SubItemScreen() {
	const { tracker, sub } = useLocalSearchParams<{
		sub: string;
		tracker: string;
	}>();

	return (
		<PageHeader eyebrow={`${tracker} · ${sub}`} title="Entries">
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
