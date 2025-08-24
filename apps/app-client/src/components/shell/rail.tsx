import clsx from "clsx";
import { router } from "expo-router";
import { ChevronRight, LogOut, Settings } from "lucide-react-native";
import { ScrollView } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import Animated, { useAnimatedStyle, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { Box } from "@/components/ui/box";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { useAuthClient, useUser } from "@/lib/atoms";
import { TrackerIcon } from "@/lib/icons";
import {
	useActiveNav,
	useNavigationData,
	useOpenFlyout,
	useScheduleFlyoutClose,
} from "@/lib/navigation";
import type { NavigationItem } from "@/lib/navigation-data";
import { navHref } from "@/lib/navigation-data";

export const RAIL_WIDTH = 168;
export const SPRING_CONFIG = { damping: 22, stiffness: 280 };

type Props = {
	pinned?: boolean;
	onClose: () => void;
	translateX?: SharedValue<number>;
};

function RailItem(props: {
	isActive: boolean;
	onPress: () => void;
	item: NavigationItem;
	onHoverIn?: () => void;
	onHoverOut?: () => void;
}) {
	const { item, onPress, isActive, onHoverIn, onHoverOut } = props;
	return (
		<Pressable
			key={item.key}
			onPress={onPress}
			onHoverIn={onHoverIn}
			onHoverOut={onHoverOut}
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
					isActive ? "text-foreground font-heading-semibold" : "text-muted-foreground font-heading",
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

export function ShellRail(props: Props) {
	const user = useUser();
	const authClient = useAuthClient();
	const openFlyout = useOpenFlyout();
	const scheduleFlyoutClose = useScheduleFlyoutClose();
	const { isViewPath, activeTrackerSlug, activeSubItemSlug } = useActiveNav();
	const { trackers, libraryViews, isLoading } = useNavigationData(user?.name);

	const { translateX, onClose, pinned = false } = props;
	const railStyle = useAnimatedStyle(() => ({
		transform: [{ translateX: translateX?.value ?? 0 }],
	}));

	function handlePress(item: NavigationItem) {
		router.push(navHref(item));
		if (!pinned && translateX) {
			translateX.value = withSpring(RAIL_WIDTH, SPRING_CONFIG, () => {
				scheduleOnRN(onClose);
			});
		}
	}

	async function handleLogout() {
		await authClient.signOut().catch(() => {});
		router.replace("/auth");
	}

	const items = (
		<ScrollView
			showsVerticalScrollIndicator={false}
			contentContainerStyle={{
				gap: 4,
				paddingTop: 64,
				flexWrap: "wrap",
				paddingBottom: 80,
				flexDirection: "row",
				paddingHorizontal: 16,
			}}
		>
			{isLoading ? (
				<Text className="text-[14px] text-muted-foreground font-heading px-2">Loading...</Text>
			) : (
				<>
					{trackers.map((tracker) => (
						<RailItem
							item={tracker}
							key={tracker.key}
							onPress={() => handlePress(tracker)}
							isActive={tracker.slug === activeTrackerSlug}
							onHoverOut={tracker.subItems.length > 0 ? scheduleFlyoutClose : undefined}
							onHoverIn={tracker.subItems.length > 0 ? () => openFlyout(tracker.slug) : undefined}
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
									item={view}
									key={view.key}
									onPress={() => handlePress(view)}
									isActive={isViewPath && view.slug === activeSubItemSlug}
								/>
							))}
						</>
					)}
				</>
			)}
		</ScrollView>
	);

	const userSection = (
		<Box className="border-t-[0.5px] border-t-border px-4 py-3 gap-2">
			<Pressable
				accessibilityRole="button"
				accessibilityLabel="Open settings"
				className="flex-row items-center gap-2"
				onPress={() => {
					router.push("/settings");
				}}
			>
				<Box className="opacity-50">
					<Settings size={14} strokeWidth={1.5} color="#78716c" />
				</Box>
				<Text className="text-[13px] text-muted-foreground font-sans">Settings</Text>
			</Pressable>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel="Log Out"
				onPress={() => void handleLogout()}
				className="flex-row items-center gap-2 min-h-8"
			>
				<Box className="opacity-50">
					<LogOut size={14} strokeWidth={1.5} color="#78716c" />
				</Box>
				<Text className="text-[12px] text-muted-foreground font-sans">Log Out</Text>
			</Pressable>
		</Box>
	);

	if (pinned) {
		return (
			<Box className="relative h-full w-42 border-l-[0.5px] border-l-border bg-stone-200">
				<Box className="flex-1">{items}</Box>
				{userSection}
				<Box
					pointerEvents="none"
					className="absolute top-0 left-0 w-px bottom-0 opacity-[0.08] bg-foreground"
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
