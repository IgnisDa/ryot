import { Plus } from "lucide-react-native";
import { ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Box } from "@/components/ui/box";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";

import {
	ActivitySection,
	RateTheseSection,
	SECTION_ACCENTS,
	StatCard,
	StatPill,
	StoryRingRow,
	UpNextSection,
} from "./overview-sections";
import { hexToRgba } from "./overview-utils";
import { useMediaOverviewData } from "./use-overview-data";

export function MediaTrackerOverview() {
	const insets = useSafeAreaInsets();

	const {
		isLoading,
		imageUrlById,
		activityItems,
		continueItems,
		rateTheseItems,
		schemaColorMap,
		upNextItems,
	} = useMediaOverviewData();

	const isEmpty =
		!isLoading &&
		upNextItems.length === 0 &&
		activityItems.length === 0 &&
		continueItems.length === 0 &&
		rateTheseItems.length === 0;

	return (
		<Box className="flex-1 bg-background">
			<ScrollView
				showsVerticalScrollIndicator={false}
				contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
			>
				<Box className="w-full web:mx-auto web:max-w-7xl">
					<Box className="px-[28]" style={{ paddingTop: insets.top + 16 }}>
						<Box className="h-7 md:hidden" />
						<Text className="mt-2 text-xs font-sans uppercase tracking-[2px] text-muted-foreground web:text-[14px]">
							Media
						</Text>
						<Text className="mt-1 text-[38px] font-heading-semibold leading-10.5 tracking-[-0.5px] text-foreground web:text-[58px] web:leading-15.5">
							Overview
						</Text>
						<Box className="mt-4 hidden flex-row items-center justify-between gap-3 lg:flex">
							<Box className="flex-row gap-3">
								<StatCard
									color={SECTION_ACCENTS.continue}
									count={continueItems.length}
									label="In Progress"
								/>
								<StatCard
									color={SECTION_ACCENTS.upNext}
									count={upNextItems.length}
									label="Queued"
								/>
								<StatCard
									color={SECTION_ACCENTS.rateThese}
									count={rateTheseItems.length}
									label="To Rate"
								/>
							</Box>
							<Pressable
								disabled
								className="flex-row items-center gap-2 rounded-full bg-primary px-5 py-3 opacity-50"
								accessibilityLabel="Track Something"
								accessibilityRole="button"
							>
								<Plus color="#1c1917" size={16} strokeWidth={2} />
								<Text className="text-[15px] font-sans-semibold text-primary-foreground web:text-[17px]">
									Track Something
								</Text>
							</Pressable>
						</Box>
						<Box className="mt-4 flex-row flex-wrap gap-2 lg:hidden">
							<StatPill
								color={SECTION_ACCENTS.continue}
								label={`${continueItems.length} in progress`}
							/>
							<StatPill color={SECTION_ACCENTS.upNext} label={`${upNextItems.length} queued`} />
							<StatPill
								color={SECTION_ACCENTS.rateThese}
								label={`${rateTheseItems.length} to rate`}
							/>
						</Box>
					</Box>

					{isEmpty ? (
						<Box className="items-center px-[28] py-16">
							<Text className="text-center text-[15px] font-sans text-muted-foreground web:text-[17px]">
								Nothing tracked yet. Tap "Track Something" to add your first entry.
							</Text>
						</Box>
					) : (
						<>
							<Box className="mt-6 hidden flex-row px-[28] lg:flex" style={{ gap: 32 }}>
								<Box className="flex-1">
									{continueItems.length > 0 && (
										<Box
											className="rounded-2xl p-5"
											style={{
												borderWidth: 1,
												borderColor: hexToRgba(SECTION_ACCENTS.continue, 0.15),
												backgroundColor: hexToRgba(SECTION_ACCENTS.continue, 0.06),
											}}
										>
											<Text
												className="mb-4 text-xs font-sans-semibold uppercase tracking-[2px] web:text-[14px]"
												style={{ color: SECTION_ACCENTS.continue }}
											>
												In Progress
											</Text>
											<StoryRingRow
												xlarge
												wrap
												wrapGap={28}
												items={continueItems}
												imageUrls={imageUrlById}
												schemaColorMap={schemaColorMap}
											/>
										</Box>
									)}
									<UpNextSection
										items={upNextItems}
										imageUrls={imageUrlById}
										schemaColorMap={schemaColorMap}
									/>
								</Box>
								<Box style={{ maxWidth: 400, width: "35%" }}>
									<RateTheseSection
										items={rateTheseItems}
										imageUrls={imageUrlById}
										schemaColorMap={schemaColorMap}
									/>
									<ActivitySection items={activityItems} schemaColorMap={schemaColorMap} />
								</Box>
							</Box>

							<Box className="lg:hidden">
								<Box className="mt-6">
									<StoryRingRow
										items={continueItems}
										imageUrls={imageUrlById}
										schemaColorMap={schemaColorMap}
									/>
								</Box>
								<Box className="px-[28]">
									<UpNextSection
										items={upNextItems}
										imageUrls={imageUrlById}
										schemaColorMap={schemaColorMap}
									/>
									<RateTheseSection
										items={rateTheseItems}
										imageUrls={imageUrlById}
										schemaColorMap={schemaColorMap}
									/>
									<ActivitySection items={activityItems} schemaColorMap={schemaColorMap} />
								</Box>
							</Box>
						</>
					)}
				</Box>
			</ScrollView>

			<Pressable
				disabled
				style={{ bottom: insets.bottom + 16, right: 20 }}
				className="absolute flex-row items-center gap-2 rounded-full bg-primary px-5 py-3 opacity-50 shadow-lg lg:hidden"
			>
				<Plus color="#1c1917" size={16} strokeWidth={2} />
				<Text className="text-[15px] font-sans-semibold text-primary-foreground web:text-[17px]">
					Track Something
				</Text>
			</Pressable>
		</Box>
	);
}
