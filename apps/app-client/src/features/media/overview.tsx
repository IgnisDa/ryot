import { Menu, Plus } from "lucide-react-native";
import { ScrollView, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Box } from "@/components/ui/box";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { useSetNavSheetOpen } from "@/lib/navigation";

import {
	ActivitySection,
	RateTheseSection,
	SECTION_ACCENTS,
	StatPill,
	StoryRingRow,
	UpNextSection,
	type ActivityItem,
	type ContinueItem,
	type RateItem,
	type UpNextItem,
} from "./overview-sections";

// ─── Fake data ────────────────────────────────────────────────────────────────

const FAKE_CONTINUE: ContinueItem[] = [
	{
		id: "c1",
		title: "Severance",
		entitySchemaSlug: "show",
		imageUri: "https://media.themoviedb.org/t/p/w500/pPHpeI2X1qEd1CS1SeyrdhZ4qnT.jpg",
		labels: { cta: "Continue", progress: "Ep 5 / 10" },
		progress: { currentUnits: 5, progressPercent: 50, totalUnits: 10 },
	},
	{
		id: "c2",
		title: "The Name of the Wind",
		entitySchemaSlug: "book",
		imageUri: "https://covers.openlibrary.org/b/isbn/0756404746-L.jpg",
		labels: { cta: "Resume", progress: "Ch 12 / 120" },
		progress: { currentUnits: 12, progressPercent: 10, totalUnits: 120 },
	},
	{
		id: "c3",
		title: "Frieren: Beyond Journey's End",
		entitySchemaSlug: "anime",
		imageUri: "https://media.themoviedb.org/t/p/w500/dqZENchTd7lp5zht7BdlqM7RBhD.jpg",
		labels: { cta: "Continue", progress: "Ep 14 / 28" },
		progress: { currentUnits: 14, progressPercent: 50, totalUnits: 28 },
	},
	{
		id: "c4",
		title: "The White Lotus",
		entitySchemaSlug: "show",
		imageUri: null,
		labels: { cta: "Continue", progress: "Ep 2 / 8" },
		progress: { currentUnits: 2, progressPercent: 25, totalUnits: 8 },
	},
];

const FAKE_UP_NEXT: UpNextItem[] = [
	{
		id: "u1",
		title: "Dune: Part Two",
		entitySchemaSlug: "movie",
		imageUri: "https://media.themoviedb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg",
		labels: { cta: "Start" },
		subtitle: { label: "2024", raw: 2024 },
	},
	{
		id: "u2",
		title: "Shogun",
		entitySchemaSlug: "show",
		imageUri: "https://media.themoviedb.org/t/p/w500/7O4iVfOMQmdCSxhOg1WnzG1AgYT.jpg",
		labels: { cta: "Start" },
		subtitle: { label: "2024", raw: 2024 },
	},
	{
		id: "u3",
		title: "Demon Slayer: Infinity Castle",
		entitySchemaSlug: "movie",
		imageUri: null,
		labels: { cta: "Start" },
		subtitle: { label: "2025", raw: 2025 },
	},
	{
		id: "u4",
		title: "Project Hail Mary",
		entitySchemaSlug: "book",
		imageUri: "https://covers.openlibrary.org/b/isbn/0593135202-L.jpg",
		labels: { cta: "Start" },
		subtitle: { label: null, raw: null },
	},
	{
		id: "u5",
		title: "Andor",
		entitySchemaSlug: "show",
		imageUri: "https://media.themoviedb.org/t/p/w500/khZqmwHQicTYoS7Flreb9EddFZC.jpg",
		labels: { cta: "Start" },
		subtitle: { label: "2022", raw: 2022 },
	},
];

const FAKE_RATE_THESE: RateItem[] = [
	{
		id: "r1",
		title: "The Bear",
		entitySchemaSlug: "show",
		imageUri: "https://media.themoviedb.org/t/p/w500/eKfVzzEazSIjJMrw9ADa2x8ksLz.jpg",
		completedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
		rating: null,
	},
	{
		id: "r2",
		title: "Oppenheimer",
		entitySchemaSlug: "movie",
		imageUri: "https://media.themoviedb.org/t/p/w500/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg",
		completedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
		rating: null,
	},
	{
		id: "r3",
		title: "Attack on Titan",
		entitySchemaSlug: "anime",
		imageUri: "https://media.themoviedb.org/t/p/w500/hTP1DtLGFamjfu8WqjnuQdP1n4i.jpg",
		completedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
		rating: null,
	},
];

const FAKE_ACTIVITY: ActivityItem[] = [
	{
		id: "a1",
		entityId: "c1",
		entityName: "Severance",
		entitySchemaSlug: "show",
		eventSchemaSlug: "progress",
		imageUri: "https://media.themoviedb.org/t/p/w500/pPHpeI2X1qEd1CS1SeyrdhZ4qnT.jpg",
		occurredAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
		rating: null,
	},
	{
		id: "a2",
		entityId: "r2",
		entityName: "Oppenheimer",
		entitySchemaSlug: "movie",
		eventSchemaSlug: "complete",
		imageUri: "https://media.themoviedb.org/t/p/w500/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg",
		occurredAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
		rating: null,
	},
	{
		id: "a3",
		entityId: "r2",
		entityName: "Oppenheimer",
		entitySchemaSlug: "movie",
		eventSchemaSlug: "review",
		imageUri: "https://media.themoviedb.org/t/p/w500/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg",
		occurredAt: new Date(Date.now() - 24 * 60 * 60 * 1000 - 3600000),
		rating: 9,
	},
	{
		id: "a4",
		entityId: "c2",
		entityName: "The Name of the Wind",
		entitySchemaSlug: "book",
		eventSchemaSlug: "progress",
		imageUri: "https://covers.openlibrary.org/b/isbn/0756404746-L.jpg",
		occurredAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
		rating: null,
	},
	{
		id: "a5",
		entityId: "c3",
		entityName: "Frieren: Beyond Journey's End",
		entitySchemaSlug: "anime",
		eventSchemaSlug: "progress",
		imageUri: "https://media.themoviedb.org/t/p/w500/dqZENchTd7lp5zht7BdlqM7RBhD.jpg",
		occurredAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
		rating: null,
	},
	{
		id: "a6",
		entityId: "r1",
		entityName: "The Bear",
		entitySchemaSlug: "show",
		eventSchemaSlug: "complete",
		imageUri: "https://media.themoviedb.org/t/p/w500/eKfVzzEazSIjJMrw9ADa2x8ksLz.jpg",
		occurredAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
		rating: null,
	},
];

// ─── Screen ───────────────────────────────────────────────────────────────────

export function MediaTrackerOverview() {
	const insets = useSafeAreaInsets();
	const { width } = useWindowDimensions();
	const isTablet = width >= 768;
	const setNavSheetOpen = useSetNavSheetOpen();

	return (
		<Box className="flex-1 bg-background">
			<ScrollView
				showsVerticalScrollIndicator={false}
				contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
			>
				<Box className="w-full web:mx-auto web:max-w-[860px]">
					{/* Page header */}
					<Box className="px-[28]" style={{ paddingTop: insets.top + 16 }}>
						{!isTablet && (
							<Box className="flex-row justify-end">
								<Pressable
									className="-mr-1 p-1"
									accessibilityLabel="Open navigation"
									accessibilityRole="button"
									onPress={() => setNavSheetOpen(true)}
								>
									<Menu color="#78716c" size={20} strokeWidth={1.5} />
								</Pressable>
							</Box>
						)}
						<Text className="mt-2 text-[10px] font-sans uppercase tracking-[2px] text-muted-foreground">
							Media
						</Text>
						<Text className="mt-0.5 text-[38px] font-heading-semibold leading-[40px] tracking-[-0.5px] text-foreground">
							Overview
						</Text>
						<Box className="mt-4 flex-row flex-wrap gap-2">
							<StatPill color={SECTION_ACCENTS.continue} label="3 in progress" />
							<StatPill color={SECTION_ACCENTS.upNext} label="8 queued" />
							<StatPill color={SECTION_ACCENTS.rateThese} label="2 to rate" />
						</Box>
					</Box>

					{/* Story rings — scrolls edge-to-edge with its own padding */}
					<Box className="mt-6">
						<StoryRingRow items={FAKE_CONTINUE} />
					</Box>

					{/* Feed sections */}
					<Box className="px-[28]">
						<UpNextSection items={FAKE_UP_NEXT} />
						<RateTheseSection items={FAKE_RATE_THESE} />
						<ActivitySection items={FAKE_ACTIVITY} />
					</Box>
				</Box>
			</ScrollView>

			<Pressable
				className="absolute flex-row items-center gap-2 rounded-full bg-primary px-5 py-3 shadow-lg"
				style={{ bottom: insets.bottom + 16, right: 20 }}
				onPress={() => console.log("Track Something pressed")}
			>
				<Plus color="#1c1917" size={16} strokeWidth={2} />
				<Text className="text-[13px] font-sans-semibold text-primary-foreground">
					Track Something
				</Text>
			</Pressable>
		</Box>
	);
}
