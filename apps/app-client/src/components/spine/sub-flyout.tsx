import clsx from "clsx";
import { router, usePathname } from "expo-router";
import { useAtomValue } from "jotai";
import { Plus } from "lucide-react-native";
import Animated, {
	FadeIn,
	FadeOut,
	SlideInRight,
	SlideOutRight,
} from "react-native-reanimated";
import { Box } from "@/components/ui/box";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { trackersAtom } from "@/lib/navigation";
import { RAIL_WIDTH } from "./rail";

export const FLYOUT_WIDTH = 220;

type Props = {
	pinned?: boolean;
};

export function SpineSubFlyout({ pinned = false }: Props) {
	const trackers = useAtomValue(trackersAtom);
	const pathname = usePathname();
	const segments = pathname.split("/").filter(Boolean);
	const activeTrackerId = segments[0] || "home";
	const activeSubItem = segments[1] || null;

	const activeTracker = trackers.find((t) => t.id === activeTrackerId);
	const subItems = activeTracker?.subItems ?? [];

	if (!subItems.length) {
		return null;
	}

	function handleSubItemPress(item: string) {
		router.push(`/${activeTrackerId}/${item}`);
	}

	const content = (
		<>
			<Text className="text-[10px] text-muted-foreground tracking-[2px] pb-3.5 font-sans px-6 uppercase">
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
								className={clsx(
									"text-[18px]",
									isActive
										? "text-primary font-heading-semibold"
										: "text-foreground font-heading",
								)}
							>
								{item}
							</Text>
						</Pressable>
					);
				})}
			</Box>
			<Box className="h-[0.5px] mt-3.5 mb-3.5 mx-6 bg-border" />
			<Pressable
				className="flex-row items-center gap-1.5 px-6 min-h-11"
				accessibilityRole="button"
			>
				<Plus size={12} color="#78716c" strokeWidth={1.5} />
				<Text className="text-[12px] text-muted-foreground font-sans">
					new schema
				</Text>
			</Pressable>
		</>
	);

	if (pinned) {
		return (
			<Animated.View
				entering={FadeIn.duration(180)}
				exiting={FadeOut.duration(150)}
				className="w-55 pt-16 pb-20 border-l-[0.5px] border-l-border bg-background"
			>
				{content}
			</Animated.View>
		);
	}

	return (
		<Animated.View
			entering={SlideInRight.duration(220)}
			exiting={SlideOutRight.duration(180)}
			className="absolute top-0 bottom-0 z-25 pt-16 pb-20 bg-background w-55"
			style={{
				elevation: 10,
				shadowRadius: 24,
				right: RAIL_WIDTH,
				shadowColor: "#000",
				shadowOpacity: 0.12,
				shadowOffset: { width: -8, height: 0 },
			}}
		>
			{content}
		</Animated.View>
	);
}
