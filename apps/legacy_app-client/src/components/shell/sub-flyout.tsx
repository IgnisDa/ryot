import clsx from "clsx";
import { Link } from "expo-router";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { Box } from "@/components/ui/box";
import { Text } from "@/components/ui/text";
import { TrackerIcon } from "@/lib/icons";
import { useActiveNav, useNavigationData } from "@/lib/navigation";

import { RAIL_WIDTH } from "./rail";

export function ShellSubFlyout() {
	const { trackers } = useNavigationData();
	const { activeTrackerSlug, activeSubItemSlug } = useActiveNav();

	const activeTracker = trackers.find((t) => t.slug === activeTrackerSlug);
	const subItems = activeTracker?.subItems ?? [];

	if (!subItems.length) {
		return null;
	}

	return (
		<Animated.View
			entering={FadeIn.duration(180)}
			exiting={FadeOut.duration(150)}
			className="absolute top-0 bottom-0 z-25 pt-16 pb-20 bg-background w-55 border-l-[0.5px] border-l-border"
			style={{ right: RAIL_WIDTH }}
		>
			<Text className="text-[10px] text-muted-foreground tracking-[2px] pb-3.5 font-sans px-6 uppercase">
				{activeTracker?.name} · {subItems.length} {subItems.length === 1 ? "view" : "views"}
			</Text>
			<Box className="gap-1 px-4">
				{subItems.map((item) => {
					const isActive = item.slug === activeSubItemSlug;
					return (
						<Link
							key={item.key}
							accessibilityRole="button"
							accessibilityLabel={item.name}
							href={`/views/${item.slug}`}
							className="min-h-11 py-2 px-2 flex-row items-center flex relative"
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
									"text-[18px]",
									isActive ? "text-primary font-heading-semibold" : "text-foreground font-heading",
								)}
							>
								{item.name}
							</Text>
						</Link>
					);
				})}
			</Box>
		</Animated.View>
	);
}
