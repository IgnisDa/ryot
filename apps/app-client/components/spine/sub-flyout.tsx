import { useAtom, useAtomValue, useSetAtom } from "jotai";
import Animated, { SlideInRight, SlideOutRight } from "react-native-reanimated";
import { Box } from "@/components/ui/box";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import {
	activeSubItemAtom,
	activeTrackerIdAtom,
	subFlyoutOpenAtom,
	trackersAtom,
} from "@/lib/navigation";
import { RAIL_WIDTH } from "./rail";

export const FLYOUT_WIDTH = 220;

type Props = {
	onNavigate: () => void;
	pinned?: boolean;
};

export function SpineSubFlyout({ onNavigate, pinned = false }: Props) {
	const trackers = useAtomValue(trackersAtom);
	const activeTrackerId = useAtomValue(activeTrackerIdAtom);
	const [activeSubItem, setActiveSubItem] = useAtom(activeSubItemAtom);
	const setSubFlyoutOpen = useSetAtom(subFlyoutOpenAtom);

	const activeTracker = trackers.find((t) => t.id === activeTrackerId);
	const subItems = activeTracker?.subItems ?? [];

	if (!subItems.length) {
		return null;
	}

	function handleSubItemPress(item: string) {
		setActiveSubItem(item);
		setSubFlyoutOpen(false);
		onNavigate();
	}

	const content = (
		<>
			<Text className="text-[10px] text-ink-soft tracking-[2px] pb-3.5 font-sans px-6 uppercase">
				{activeTracker?.name} · {subItems.length} schemas
			</Text>
			<Box className="gap-1 flex-wrap flex-row px-4">
				{subItems.map((item) => {
					const isActive = item === activeSubItem;
					return (
						<Pressable
							key={item}
							accessibilityLabel={item}
							accessibilityRole="button"
							onPress={() => handleSubItemPress(item)}
							className="min-h-11 py-2 px-2 justify-center"
						>
							<Text
								className={`text-[18px] ${isActive ? "text-terra font-serif-medium-italic" : "text-ink font-serif"}`}
							>
								{item}
							</Text>
						</Pressable>
					);
				})}
			</Box>
			<Box className="h-[0.5px] mt-3.5 mb-3.5 mx-6 bg-ink/20" />
			<Text className="text-[12px] text-ink-soft font-sans px-6">
				＋ new schema
			</Text>
		</>
	);

	if (pinned) {
		return (
			<Box className="w-55 pt-16 pb-20 border-l-[0.5px] border-l-ink/20 bg-paper">
				{content}
			</Box>
		);
	}

	return (
		<Animated.View
			className="absolute top-0 bottom-0 z-25 pt-16 pb-20 bg-paper w-55"
			style={{
				elevation: 10,
				shadowRadius: 24,
				right: RAIL_WIDTH,
				shadowColor: "#000",
				shadowOpacity: 0.12,
				shadowOffset: { width: -8, height: 0 },
			}}
			entering={SlideInRight.duration(220)}
			exiting={SlideOutRight.duration(180)}
		>
			{content}
		</Animated.View>
	);
}
