import clsx from "clsx";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { ChevronRight } from "lucide-react-native";
import { ScrollView } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import Animated, {
	useAnimatedStyle,
	withSpring,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { Box } from "@/components/ui/box";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import type { Tracker } from "@/lib/navigation";
import {
	activeSubItemAtom,
	activeTrackerIdAtom,
	subFlyoutOpenAtom,
	trackersAtom,
} from "@/lib/navigation";

export const RAIL_WIDTH = 168;
export const SPRING_CONFIG = { damping: 22, stiffness: 280 };

type Props = {
	pinned?: boolean;
	onClose: () => void;
	translateX?: SharedValue<number>;
};

export function SpineRail({ translateX, onClose, pinned = false }: Props) {
	const trackers = useAtomValue(trackersAtom);
	const [activeTrackerId, setActiveTrackerId] = useAtom(activeTrackerIdAtom);
	const setActiveSubItem = useSetAtom(activeSubItemAtom);
	const [subFlyoutOpen, setSubFlyoutOpen] = useAtom(subFlyoutOpenAtom);

	const railStyle = useAnimatedStyle(() => ({
		transform: [{ translateX: translateX?.value ?? 0 }],
	}));

	function handleTrackerPress(tracker: Tracker) {
		if (tracker.subItems?.length) {
			if (activeTrackerId === tracker.id && subFlyoutOpen) {
				setSubFlyoutOpen(false);
			} else {
				setActiveTrackerId(tracker.id);
				setSubFlyoutOpen(true);
			}
		} else {
			setActiveTrackerId(tracker.id);
			setActiveSubItem(null);
			setSubFlyoutOpen(false);
			if (!pinned && translateX) {
				translateX.value = withSpring(RAIL_WIDTH, SPRING_CONFIG, () => {
					scheduleOnRN(onClose);
				});
			}
		}
	}

	const items = (
		<ScrollView
			contentContainerStyle={{
				gap: 4,
				paddingTop: 64,
				flexWrap: "wrap",
				paddingBottom: 80,
				flexDirection: "row",
				paddingHorizontal: 16,
			}}
			showsVerticalScrollIndicator={false}
		>
			{trackers.map((tracker) => {
				const isActive = tracker.id === activeTrackerId;
				return (
					<Pressable
						key={tracker.id}
						className="min-h-11 py-2.5 flex-row items-center px-2 relative"
						accessibilityRole="button"
						accessibilityLabel={tracker.name}
						onPress={() => handleTrackerPress(tracker)}
					>
						{isActive && (
							<Box className="absolute top-2 left-0 w-0.75 bottom-2 bg-primary" />
						)}
						<Text
							className={clsx(
								"text-[17px] tracking-[0.2px]",
								isActive
									? "text-foreground font-heading-semibold"
									: "text-muted-foreground font-heading",
							)}
						>
							{tracker.name}
						</Text>
						{tracker.subItems?.length ? (
							<Box className="opacity-60 ml-1">
								<ChevronRight size={14} color="#78716c" strokeWidth={1.5} />
							</Box>
						) : null}
					</Pressable>
				);
			})}
		</ScrollView>
	);

	if (pinned) {
		return (
			<Box className="w-42 border-l-[0.5px] border-l-border bg-stone-200">
				{items}
				<Box
					className="absolute top-0 left-0 w-px bottom-0 opacity-[0.08] bg-foreground"
					pointerEvents="none"
				/>
			</Box>
		);
	}

	return (
		<Animated.View
			className="absolute top-0 right-0 bottom-0 z-30 w-42 border-l-[0.5px] border-l-border bg-stone-200"
			style={[
				railStyle,
				{
					elevation: 12,
					shadowRadius: 24,
					shadowColor: "#000",
					shadowOpacity: 0.12,
					shadowOffset: { width: -8, height: 0 },
				},
			]}
		>
			{items}
			<Box
				pointerEvents="none"
				className="absolute top-0 left-0 w-px bottom-0 opacity-[0.08] bg-foreground"
			/>
		</Animated.View>
	);
}
