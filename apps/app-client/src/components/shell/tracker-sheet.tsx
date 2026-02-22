import clsx from "clsx";
import type { Href } from "expo-router";
import { router, usePathname } from "expo-router";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { useState } from "react";
import { ScrollView } from "react-native";
import Animated, {
	FadeIn,
	FadeOut,
	SlideInDown,
	SlideOutDown,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Box } from "@/components/ui/box";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { useUser } from "@/lib/atoms";
import { TrackerIcon } from "@/lib/icons";
import type { NavigationItem, NavigationSubItem } from "@/lib/navigation";
import { useNavigationData, useSetNavSheetOpen } from "@/lib/navigation";

export function TrackerSheet() {
	const user = useUser();
	const setOpen = useSetNavSheetOpen();
	const { trackers, libraryViews, userItem, isLoading } = useNavigationData(
		user?.name,
	);
	const pathname = usePathname();
	const segments = pathname.split("/").filter(Boolean);
	const activeTrackerSlug = segments[0] || "home";
	const activeSubItem = segments[1] || null;
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const insets = useSafeAreaInsets();

	function close() {
		setOpen(false);
	}

	function handleTrackerPress(tracker: NavigationItem) {
		if (tracker.subItems.length > 0) {
			setExpandedId((prev) => (prev === tracker.key ? null : tracker.key));
		} else {
			const href: Href =
				tracker.kind === "home" ? "/" : (`/${tracker.slug}` as Href);
			router.push(href);
			close();
		}
	}

	function handleSubItemPress(trackerSlug: string, subItem: NavigationSubItem) {
		router.push(`/${trackerSlug}/${subItem.slug}` as Href);
		close();
	}

	return (
		<Box className="absolute inset-0 z-20" pointerEvents="box-none">
			<Animated.View
				pointerEvents="auto"
				entering={FadeIn.duration(200)}
				exiting={FadeOut.duration(180)}
				className="absolute inset-0 bg-foreground/40"
			>
				<Pressable
					onPress={close}
					className="absolute inset-0"
					accessibilityLabel="Close navigation"
				/>
			</Animated.View>

			<Animated.View
				entering={SlideInDown.duration(280)}
				exiting={SlideOutDown.duration(220)}
				className="absolute bottom-0 left-0 right-0 bg-stone-200 rounded-t-3xl overflow-hidden"
				style={{
					elevation: 16,
					maxHeight: "72%",
					shadowRadius: 24,
					shadowColor: "#000",
					shadowOpacity: 0.18,
					shadowOffset: { width: 0, height: -4 },
				}}
			>
				<Box className="items-center pt-3 pb-2">
					<Box className="w-9 h-1 rounded-full bg-stone-400" />
				</Box>

				<ScrollView
					showsVerticalScrollIndicator={false}
					contentContainerStyle={{
						paddingTop: 4,
						paddingBottom: insets.bottom + 24,
					}}
				>
					{isLoading ? (
						<Text className="text-[14px] text-muted-foreground font-heading px-6 py-4">
							Loading...
						</Text>
					) : (
						<>
							{trackers.map((tracker) => {
								const isActive = tracker.slug === activeTrackerSlug;
								const isExpanded = expandedId === tracker.key;
								return (
									<Box key={tracker.key}>
										<Pressable
											accessibilityRole="button"
											accessibilityLabel={tracker.name}
											onPress={() => handleTrackerPress(tracker)}
											className="flex-row items-center px-6 min-h-13 relative"
										>
											{isActive && (
												<Box
													className="absolute left-0 top-2 bottom-2 w-0.75"
													style={{
														backgroundColor: tracker.accentColor ?? undefined,
													}}
												/>
											)}
											<Box className="mr-2">
												<TrackerIcon icon={tracker.icon} size={16} />
											</Box>
											<Text
												className={clsx(
													"flex-1 text-[17px] tracking-[0.2px]",
													isActive
														? "text-foreground font-heading-semibold"
														: "text-muted-foreground font-heading",
												)}
											>
												{tracker.name}
											</Text>
											{tracker.subItems.length > 0 ? (
												<Box className="opacity-60 ml-2">
													{isExpanded ? (
														<ChevronDown
															size={14}
															color="#78716c"
															strokeWidth={1.5}
														/>
													) : (
														<ChevronRight
															size={14}
															color="#78716c"
															strokeWidth={1.5}
														/>
													)}
												</Box>
											) : null}
										</Pressable>

										{isExpanded && (
											<Animated.View entering={FadeIn.duration(150)}>
												{tracker.subItems.map((item) => {
													const isSubActive =
														isActive && item.slug === activeSubItem;
													return (
														<Pressable
															key={item.key}
															accessibilityRole="button"
															accessibilityLabel={item.name}
															className="pl-13 pr-6 min-h-11 justify-center flex-row items-center"
															onPress={() =>
																handleSubItemPress(tracker.slug, item)
															}
														>
															<Box className="mr-2">
																<TrackerIcon icon={item.icon} size={14} />
															</Box>
															<Text
																className={clsx(
																	"flex-1 text-[18px]",
																	isSubActive
																		? "text-primary font-heading-semibold"
																		: "text-foreground font-heading",
																)}
															>
																{item.name}
															</Text>
														</Pressable>
													);
												})}
											</Animated.View>
										)}
									</Box>
								);
							})}

							{libraryViews.length > 0 && (
								<>
									<Box className="mt-3 mb-1 px-6">
										<Box className="h-[0.5px] bg-border mb-3.5" />
										<Text className="text-[10px] tracking-[2px] text-muted-foreground font-sans uppercase">
											Views
										</Text>
									</Box>
									{libraryViews.map((view) => {
										const isActive = view.slug === activeTrackerSlug;
										return (
											<Pressable
												key={view.key}
												accessibilityRole="button"
												accessibilityLabel={view.name}
												onPress={() => handleTrackerPress(view)}
												className="flex-row items-center px-6 min-h-13 relative"
											>
												{isActive && (
													<Box
														className="absolute left-0 top-2 bottom-2 w-0.75"
														style={{
															backgroundColor: view.accentColor ?? undefined,
														}}
													/>
												)}
												<Box className="mr-2">
													<TrackerIcon icon={view.icon} size={16} />
												</Box>
												<Text
													className={clsx(
														"flex-1 text-[17px] tracking-[0.2px]",
														isActive
															? "text-foreground font-heading-semibold"
															: "text-muted-foreground font-heading",
													)}
												>
													{view.name}
												</Text>
											</Pressable>
										);
									})}
								</>
							)}
						</>
					)}

					<Box className="mx-6 mt-2">
						<Box className="h-[0.5px] bg-border mb-3.5" />
						<Box className="flex-row items-center gap-2 min-h-11">
							<Box className="opacity-40">
								<TrackerIcon icon="user" size={16} />
							</Box>
							<Text className="text-[14px] text-muted-foreground font-heading">
								{userItem.name}
							</Text>
						</Box>
					</Box>
				</ScrollView>
			</Animated.View>
		</Box>
	);
}
