import { usePathname } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { Box } from "@/components/ui/box";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { TrackerIcon } from "@/lib/icons";
import { useNavigationData, useSetSearchOpen } from "@/lib/navigation";

export function BreadcrumbChip() {
	const pathname = usePathname();
	const { trackers } = useNavigationData();
	const setSearchOpen = useSetSearchOpen();
	const segments = pathname.split("/").filter(Boolean);
	const activeTrackerSlug = segments[0] || "home";
	const activeSubItem = segments[1] || null;

	const activeTracker = trackers.find((t) => t.slug === activeTrackerSlug);
	if (!activeTracker) {
		return null;
	}

	const activeView = activeSubItem
		? activeTracker.subItems.find((s) => s.slug === activeSubItem)
		: null;

	return (
		<Pressable
			accessibilityRole="button"
			onPress={() => setSearchOpen(true)}
			accessibilityLabel={`Current location: ${activeTracker.name}${activeView ? ` › ${activeView.name}` : ""}. Tap to search.`}
			className="gap-2 pl-2 pr-3 rounded-[14px] border-[0.5px] py-1.25 flex-row border-border items-center self-start bg-stone-200"
		>
			<Box className="opacity-80">
				<TrackerIcon icon={activeTracker.icon} size={12} />
			</Box>
			<Text className="text-[11px] text-foreground tracking-[0.3px] font-sans-medium">
				{activeTracker.name}
			</Text>
			{activeView != null && (
				<>
					<Box className="opacity-40">
						<ChevronRight size={10} color="#57534e" strokeWidth={1.5} />
					</Box>
					<Text className="text-[12px] text-muted-foreground font-heading">
						{activeView.name}
					</Text>
				</>
			)}
		</Pressable>
	);
}
