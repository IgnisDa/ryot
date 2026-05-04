import clsx from "clsx";
import { Link, usePathname } from "expo-router";
import Animated, {
	FadeIn,
	FadeOut,
	SlideInRight,
	SlideOutRight,
} from "react-native-reanimated";
import { Box } from "@/components/ui/box";
import { Text } from "@/components/ui/text";
import { TrackerIcon } from "@/lib/icons";
import { useNavigationData } from "@/lib/navigation";
import { RAIL_WIDTH } from "./rail";

export const FLYOUT_WIDTH = 220;

type Props = {
	pinned?: boolean;
};

export function SpineSubFlyout({ pinned = false }: Props) {
	const pathname = usePathname();
	const { trackers } = useNavigationData();
	const segments = pathname.split("/").filter(Boolean);
	const activeTrackerSlug = segments[0] || "home";
	const activeSubItem = segments[1] || null;

	const activeTracker = trackers.find((t) => t.slug === activeTrackerSlug);
	const subItems = activeTracker?.subItems ?? [];

	if (!subItems.length) {
		return null;
	}

	const content = (
		<>
			<Text className="text-[10px] text-muted-foreground tracking-[2px] pb-3.5 font-sans px-6 uppercase">
				{activeTracker?.name} · {subItems.length}{" "}
				{subItems.length === 1 ? "view" : "views"}
			</Text>
			<Box className="gap-1 px-4">
				{subItems.map((item) => {
					const isActive = item.slug === activeSubItem;
					return (
						<Link
							key={item.key}
							accessibilityRole="button"
							accessibilityLabel={item.name}
							href={`/${activeTrackerSlug}/${item.slug}`}
							className="min-h-11 py-2 px-2 flex-row items-center flex"
						>
							<Box className="mr-2">
								<TrackerIcon icon={item.icon} size={14} />
							</Box>
							<Text
								className={clsx(
									"text-[18px]",
									isActive
										? "text-primary font-heading-semibold"
										: "text-foreground font-heading",
								)}
							>
								{item.name}
							</Text>
						</Link>
					);
				})}
			</Box>
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
