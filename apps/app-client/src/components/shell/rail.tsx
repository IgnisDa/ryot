import clsx from "clsx";
import type { Href } from "expo-router";
import { router, usePathname } from "expo-router";
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
import { useUser } from "@/lib/atoms";
import { TrackerIcon } from "@/lib/icons";
import type { NavigationItem } from "@/lib/navigation";
import { useNavigationData, useSetSubFlyoutOpen } from "@/lib/navigation";

export const RAIL_WIDTH = 168;
export const SPRING_CONFIG = { damping: 22, stiffness: 280 };

type Props = {
	pinned?: boolean;
	onClose: () => void;
	translateX?: SharedValue<number>;
};

function RailItem({
	item,
	isActive,
	onPress,
}: {
	item: NavigationItem;
	isActive: boolean;
	onPress: () => void;
}) {
	return (
		<Pressable
			key={item.key}
			onPress={onPress}
			accessibilityRole="button"
			accessibilityLabel={item.name}
			className="min-h-11 py-2.5 flex-row items-center px-2 relative"
		>
			{isActive && (
				<Box
					className="absolute top-2 left-0 w-0.75 bottom-2"
					style={{ backgroundColor: item.accentColor ?? undefined }}
				/>
			)}
			<Box className="mr-1.5">
				<TrackerIcon icon={item.icon} size={14} />
			</Box>
			<Text
				className={clsx(
					"text-[17px] tracking-[0.2px]",
					isActive
						? "text-foreground font-heading-semibold"
						: "text-muted-foreground font-heading",
				)}
			>
				{item.name}
			</Text>
			{item.subItems.length > 0 ? (
				<Box className="opacity-60 ml-1">
					<ChevronRight size={14} color="#78716c" strokeWidth={1.5} />
				</Box>
			) : null}
		</Pressable>
	);
}

export function ShellRail({ translateX, onClose, pinned = false }: Props) {
	const user = useUser();
	const setSubFlyoutOpen = useSetSubFlyoutOpen();
	const { trackers, libraryViews, userItem, isLoading } = useNavigationData(
		user?.name,
	);
	const pathname = usePathname();
	const segments = pathname.split("/").filter(Boolean);
	const isViewPath = segments[0] === "views";
	const activeViewSlug = isViewPath ? (segments[1] ?? null) : null;
	const activeTrackerSlug = isViewPath
		? (trackers.find((t) => t.subItems.some((s) => s.slug === activeViewSlug))
				?.slug ?? "home")
		: segments[0] || "home";

	const railStyle = useAnimatedStyle(() => ({
		transform: [{ translateX: translateX?.value ?? 0 }],
	}));

	function handlePress(item: NavigationItem) {
		if (item.kind === "view") {
			if (isViewPath && item.slug === activeViewSlug) {
				return;
			}
			router.push(`/views/${item.slug}` as Href);
			if (!pinned && translateX) {
				translateX.value = withSpring(RAIL_WIDTH, SPRING_CONFIG, () => {
					scheduleOnRN(onClose);
				});
			}
			return;
		}
		if (item.slug === activeTrackerSlug) {
			if (item.subItems.length > 0) {
				setSubFlyoutOpen((prev) => !prev);
			}
			return;
		}
		const href: Href = item.kind === "home" ? "/" : (`/${item.slug}` as Href);
		router.push(href);
		if (!pinned && translateX) {
			translateX.value = withSpring(RAIL_WIDTH, SPRING_CONFIG, () => {
				scheduleOnRN(onClose);
			});
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
			{isLoading ? (
				<Text className="text-[14px] text-muted-foreground font-heading px-2">
					Loading...
				</Text>
			) : (
				<>
					{trackers.map((tracker) => (
						<RailItem
							key={tracker.key}
							item={tracker}
							onPress={() => handlePress(tracker)}
							isActive={tracker.slug === activeTrackerSlug}
						/>
					))}

					{libraryViews.length > 0 && (
						<>
							<Box className="w-full mt-3 mb-1 px-2">
								<Text className="text-[10px] tracking-[2px] text-muted-foreground font-sans uppercase">
									Views
								</Text>
							</Box>
							{libraryViews.map((view) => (
								<RailItem
									key={view.key}
									item={view}
									onPress={() => handlePress(view)}
									isActive={isViewPath && view.slug === activeViewSlug}
								/>
							))}
						</>
					)}
				</>
			)}
		</ScrollView>
	);

	const userSection = (
		<Box className="border-t-[0.5px] border-t-border px-4 py-3">
			<Box className="flex-row items-center gap-2">
				<Box className="opacity-50">
					<TrackerIcon icon="user" size={14} />
				</Box>
				<Text className="text-[13px] text-muted-foreground font-sans">
					{userItem.name}
				</Text>
			</Box>
		</Box>
	);

	if (pinned) {
		return (
			<Box className="w-42 border-l-[0.5px] border-l-border bg-stone-200">
				<Box className="flex-1">{items}</Box>
				{userSection}
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
			<Box className="flex-1">{items}</Box>
			{userSection}
			<Box
				pointerEvents="none"
				className="absolute top-0 left-0 w-px bottom-0 opacity-[0.08] bg-foreground"
			/>
		</Animated.View>
	);
}
