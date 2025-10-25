import clsx from "clsx";
import { router } from "expo-router";
import { ScrollView } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { Box } from "@/components/ui/box";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { TrackerIcon } from "@/lib/icons";
import {
	useActiveNav,
	useCloseFlyout,
	useHoveredTrackerSlug,
	useNavigationData,
	useOpenFlyout,
	useScheduleFlyoutClose,
} from "@/lib/navigation";
import { viewHref } from "@/lib/navigation-data";

import { RAIL_WIDTH } from "./rail";

export function ShellSubFlyout() {
	const openFlyout = useOpenFlyout();
	const closeFlyout = useCloseFlyout();
	const { trackers } = useNavigationData();
	const hoveredTrackerSlug = useHoveredTrackerSlug();
	const scheduleFlyoutClose = useScheduleFlyoutClose();
	const { activeTrackerSlug, activeSubItemSlug } = useActiveNav();

	const effectiveSlug = hoveredTrackerSlug ?? activeTrackerSlug;
	const activeTracker = trackers.find((t) => t.slug === effectiveSlug);
	const subItems = activeTracker?.subItems ?? [];

	if (!subItems.length) {
		return null;
	}

	return (
		<Animated.View
			style={{ right: RAIL_WIDTH }}
			entering={FadeIn.duration(180)}
			exiting={FadeOut.duration(150)}
			className="absolute top-0 bottom-0 z-25 bg-background w-55 border-l-[0.5px] border-l-border"
		>
			<Pressable
				onPress={closeFlyout}
				className="flex-1 pt-16 pb-20"
				onHoverOut={scheduleFlyoutClose}
				onHoverIn={() => openFlyout(effectiveSlug)}
			>
				<Text className="text-[10px] text-muted-foreground tracking-[2px] pb-3.5 font-sans px-6 uppercase">
					{activeTracker?.name} · {subItems.length} {subItems.length === 1 ? "view" : "views"}
				</Text>
				<ScrollView style={{ flex: 1 }}>
					<Box className="gap-1 px-4">
						{subItems.map((item) => {
							const isActive = item.slug === activeSubItemSlug;
							return (
								<Pressable
									key={item.key}
									accessibilityRole="link"
									accessibilityLabel={item.name}
									onHoverOut={scheduleFlyoutClose}
									onHoverIn={() => openFlyout(effectiveSlug)}
									className="min-h-11 py-2 px-2 flex-row items-center relative"
									onPress={() => {
										router.push(viewHref(item.slug));
										closeFlyout();
									}}
								>
									{isActive && (
										<Box
											className="absolute left-0 top-2 bottom-2 w-0.75"
											style={{ backgroundColor: item.accentColor ?? undefined }}
										/>
									)}
									<Box className="mr-2">
										<TrackerIcon icon={item.icon} size={14} />
									</Box>
									<Text
										className={clsx(
											"text-[15px]",
											isActive
												? "text-primary font-heading-semibold"
												: "text-foreground font-heading",
										)}
									>
										{item.name}
									</Text>
								</Pressable>
							);
						})}
					</Box>
				</ScrollView>
			</Pressable>
		</Animated.View>
	);
}
