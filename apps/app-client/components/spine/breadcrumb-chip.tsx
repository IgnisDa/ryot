import { useAtomValue, useSetAtom } from "jotai";
import { Box } from "@/components/ui/box";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import {
	activeSubItemAtom,
	activeTrackerIdAtom,
	searchOpenAtom,
	trackersAtom,
} from "@/lib/navigation";

export function BreadcrumbChip() {
	const trackers = useAtomValue(trackersAtom);
	const activeTrackerId = useAtomValue(activeTrackerIdAtom);
	const activeSubItem = useAtomValue(activeSubItemAtom);
	const setSearchOpen = useSetAtom(searchOpenAtom);

	const activeTracker = trackers.find((t) => t.id === activeTrackerId);
	if (!activeTracker) {
		return null;
	}

	return (
		<Pressable
			className="gap-2 pl-2 pr-3 rounded-[14px] border-[0.5px] py-1.25 flex-row border-ink/20 items-center self-start bg-paper-deep"
			accessibilityRole="button"
			onPress={() => setSearchOpen(true)}
			accessibilityLabel={`Current location: ${activeTracker.name}${activeSubItem ? ` › ${activeSubItem}` : ""}. Tap to search.`}
		>
			<Box className="w-1.5 h-1.5 rounded-full bg-terra" />
			<Text className="text-[11px] text-ink tracking-[0.3px] font-sans-medium">
				{activeTracker.name}
			</Text>
			{activeSubItem != null && (
				<>
					<Text className="text-[11px] opacity-40 text-ink-soft font-sans">
						›
					</Text>
					<Text className="text-[12px] text-ink-soft font-serif-italic">
						{activeSubItem}
					</Text>
				</>
			)}
		</Pressable>
	);
}
