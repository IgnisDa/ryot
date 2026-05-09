import { usePathname } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { Box } from "@/components/ui/box";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { useSetSearchOpen, useTrackers } from "@/lib/navigation";

export function BreadcrumbChip() {
	const trackers = useTrackers();
	const pathname = usePathname();
	const segments = pathname.split("/").filter(Boolean);
	const activeTrackerId = segments[0] || "home";
	const activeSubItem = segments[1] || null;
	const setSearchOpen = useSetSearchOpen();

	const activeTracker = trackers.find((t) => t.id === activeTrackerId);
	if (!activeTracker) {
		return null;
	}

	return (
		<Pressable
			accessibilityRole="button"
			onPress={() => setSearchOpen(true)}
			accessibilityLabel={`Current location: ${activeTracker.name}${activeSubItem ? ` › ${activeSubItem}` : ""}. Tap to search.`}
			className="gap-2 pl-2 pr-3 rounded-[14px] border-[0.5px] py-1.25 flex-row border-border items-center self-start bg-stone-200"
		>
			<Box className="w-1.5 h-1.5 rounded-full bg-primary" />
			<Text className="text-[11px] text-foreground tracking-[0.3px] font-sans-medium">
				{activeTracker.name}
			</Text>
			{activeSubItem != null && (
				<>
					<Box className="opacity-40">
						<ChevronRight size={10} color="#57534e" strokeWidth={1.5} />
					</Box>
					<Text className="text-[12px] text-muted-foreground font-heading">
						{activeSubItem}
					</Text>
				</>
			)}
		</Pressable>
	);
}
