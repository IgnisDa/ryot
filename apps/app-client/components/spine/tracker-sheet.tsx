import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { ChevronDown, ChevronRight, Plus } from "lucide-react-native";
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
import {
	activeSubItemAtom,
	activeTrackerIdAtom,
	navSheetOpenAtom,
	type Tracker,
	trackersAtom,
} from "@/lib/navigation";

export function TrackerSheet() {
	const setOpen = useSetAtom(navSheetOpenAtom);
	const trackers = useAtomValue(trackersAtom);
	const [activeTrackerId, setActiveTrackerId] = useAtom(activeTrackerIdAtom);
	const [activeSubItem, setActiveSubItem] = useAtom(activeSubItemAtom);
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const insets = useSafeAreaInsets();

	function close() {
		setOpen(false);
	}

	function handleTrackerPress(tracker: Tracker) {
		if (tracker.subItems?.length) {
			setExpandedId((prev) => (prev === tracker.id ? null : tracker.id));
		} else {
			setActiveTrackerId(tracker.id);
			setActiveSubItem(null);
			close();
		}
	}

	function handleSubItemPress(trackerId: string, item: string) {
		setActiveSubItem(item);
		setActiveTrackerId(trackerId);
		close();
	}

	return (
		<Box className="absolute inset-0 z-20" pointerEvents="box-none">
			<Animated.View
				pointerEvents="auto"
				className="absolute inset-0 bg-ink/40"
				entering={FadeIn.duration(200)}
				exiting={FadeOut.duration(180)}
			>
				<Pressable
					className="absolute inset-0"
					onPress={close}
					accessibilityLabel="Close navigation"
				/>
			</Animated.View>

			<Animated.View
				entering={SlideInDown.duration(280)}
				exiting={SlideOutDown.duration(220)}
				className="absolute bottom-0 left-0 right-0 bg-paper-deep rounded-t-3xl overflow-hidden"
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
					<Box className="w-9 h-1 rounded-full bg-ink/20" />
				</Box>

				<ScrollView
					showsVerticalScrollIndicator={false}
					contentContainerStyle={{
						paddingTop: 4,
						paddingBottom: insets.bottom + 24,
					}}
				>
					{trackers.map((tracker) => {
						const isActive = tracker.id === activeTrackerId;
						const isExpanded = expandedId === tracker.id;
						return (
							<Box key={tracker.id}>
								<Pressable
									accessibilityRole="button"
									accessibilityLabel={tracker.name}
									onPress={() => handleTrackerPress(tracker)}
									className="flex-row items-center px-6 min-h-13 relative"
								>
									{isActive && (
										<Box className="absolute left-0 top-2 bottom-2 w-0.75 bg-terra" />
									)}
									<Text
										className={`flex-1 text-[17px] tracking-[0.2px] ${
											isActive
												? "text-ink font-serif-medium-italic"
												: "text-ink-soft font-serif"
										}`}
									>
										{tracker.name}
									</Text>
									{tracker.subItems?.length ? (
										<Box className="opacity-60 ml-2">
											{isExpanded ? (
												<ChevronDown
													size={14}
													color="#8a8378"
													strokeWidth={1.5}
												/>
											) : (
												<ChevronRight
													size={14}
													color="#8a8378"
													strokeWidth={1.5}
												/>
											)}
										</Box>
									) : null}
								</Pressable>

								{isExpanded && (
									<Animated.View
										entering={FadeIn.duration(150)}
										exiting={FadeOut.duration(120)}
									>
										{tracker.subItems?.map((item) => {
											const isSubActive = isActive && item === activeSubItem;
											return (
												<Pressable
													key={item}
													accessibilityLabel={item}
													accessibilityRole="button"
													className="pl-10 pr-6 min-h-11 justify-center"
													onPress={() => handleSubItemPress(tracker.id, item)}
												>
													<Text
														className={`text-[18px] ${
															isSubActive
																? "text-terra font-serif-medium-italic"
																: "text-ink font-serif"
														}`}
													>
														{item}
													</Text>
												</Pressable>
											);
										})}
									</Animated.View>
								)}
							</Box>
						);
					})}

					<Box className="mx-6 mt-2">
						<Box className="h-[0.5px] bg-ink/20 mb-3.5" />
						<Pressable
							accessibilityRole="button"
							className="flex-row items-center gap-1.5 min-h-11"
						>
							<Plus size={12} color="#5a5347" strokeWidth={1.5} />
							<Text className="text-[12px] text-ink-soft font-sans">
								new tracker
							</Text>
						</Pressable>
					</Box>
				</ScrollView>
			</Animated.View>
		</Box>
	);
}
