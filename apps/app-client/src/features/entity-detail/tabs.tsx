import clsx from "clsx";
import { GlassView } from "expo-glass-effect";
import {
	BookOpen,
	CalendarDays,
	Clock,
	Gamepad2,
	Layers,
	Mic,
	Sparkles,
} from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Image, Platform, ScrollView } from "react-native";
import Animated, {
	FadeIn,
	interpolate,
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { match } from "ts-pattern";

import { Box } from "@/components/ui/box";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";

import type { loadRelatedCollections } from "./collections";
import type { RelatedCompany } from "./companies";
import type { loadRelatedGroups } from "./groups";
import { HeroSection } from "./hero-section";
import {
	AboutSection,
	CollectionsSection,
	CompaniesSection,
	CreatorsSection,
	DetailsSection,
	GroupsSection,
} from "./sections";
import {
	AnimeAiringSchedule,
	PodcastEpisodesList,
	ShowSeasonsList,
	VideoGameStats,
} from "./type-specific-sections";
import type { EntityDetail, UnlinkedCreator } from "./types";

type Collections = Awaited<ReturnType<typeof loadRelatedCollections>>;

type Groups = Awaited<ReturnType<typeof loadRelatedGroups>>;

type TabConfig = {
	key: string;
	label: string;
	Icon: React.ComponentType<{ size?: number; strokeWidth?: number; color?: string }>;
};

const ACCENT = "#C9943A";
const INACTIVE_COLOR = Platform.select({
	default: "rgba(0,0,0,0.5)",
	ios: "rgba(255,255,255,0.82)",
});

function getTypeSpecificTab(entity: EntityDetail): TabConfig | null {
	return match(entity)
		.with({ entitySchemaSlug: "show" }, (e) =>
			e.properties.showSeasons.length > 0
				? { key: "seasons", label: "Seasons", Icon: Layers }
				: null,
		)
		.with({ entitySchemaSlug: "podcast" }, (e) =>
			e.properties.episodes.length > 0 ? { key: "episodes", label: "Episodes", Icon: Mic } : null,
		)
		.with({ entitySchemaSlug: "anime" }, (e) =>
			e.properties.airingSchedule != null && e.properties.airingSchedule.length > 0
				? { key: "schedule", label: "Schedule", Icon: CalendarDays }
				: null,
		)
		.with({ entitySchemaSlug: "video-game" }, (e) =>
			e.properties.timeToBeat != null ||
			(e.properties.platformReleases != null && e.properties.platformReleases.length > 0)
				? { key: "platforms", label: "Platforms", Icon: Gamepad2 }
				: null,
		)
		.otherwise(() => null);
}

function OverviewTab(props: {
	entity: EntityDetail;
	groups: Groups | null;
	creators: UnlinkedCreator[];
	companies: RelatedCompany[];
	collections: Collections | null;
}) {
	return (
		<Box className="web:mx-auto web:max-w-7xl">
			<Box className="px-7 pt-8 md:grid md:grid-cols-[2fr_1fr] md:items-start md:gap-10 md:px-10">
				<Box>
					<AboutSection entity={props.entity} creators={props.creators} />
					<CreatorsSection creators={props.creators} />
					<CompaniesSection companies={props.companies} />
				</Box>
				<Box>
					<DetailsSection entity={props.entity} creators={props.creators} />
					<GroupsSection groups={props.groups} entitySchemaSlug={props.entity.entitySchemaSlug} />
					<CollectionsSection collections={props.collections} />
				</Box>
			</Box>
		</Box>
	);
}

function TypeSpecificTab(props: { entity: EntityDetail }) {
	return (
		<Box className="px-7 pt-8 web:mx-auto web:w-full web:max-w-7xl md:px-10">
			{match(props.entity)
				.with({ entitySchemaSlug: "show" }, (e) => <ShowSeasonsList entity={e} />)
				.with({ entitySchemaSlug: "podcast" }, (e) => <PodcastEpisodesList entity={e} />)
				.with({ entitySchemaSlug: "anime" }, (e) => <AnimeAiringSchedule entity={e} />)
				.with({ entitySchemaSlug: "video-game" }, (e) => <VideoGameStats entity={e} />)
				.otherwise(() => null)}
		</Box>
	);
}

// TODO: Remove this
function PlaceholderTab(props: { seed: number }) {
	return (
		<Box className="px-7 pt-8 web:mx-auto web:max-w-7xl">
			<Box className="mb-6 h-50 overflow-hidden rounded-xl bg-muted">
				<Image
					resizeMode="cover"
					className="h-full w-full"
					source={{ uri: `https://picsum.photos/seed/${props.seed}/800/400` }}
				/>
			</Box>
			<Text className="mb-4 font-heading-semibold text-[20px] text-foreground">Coming Soon</Text>
			<Text className="text-[15px] leading-relaxed text-muted-foreground">
				Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut
				labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco
				laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in
				voluptate velit esse cillum dolore eu fugiat nulla pariatur.
			</Text>
			<Text className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
				Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit
				anim id est laborum. Sed ut perspiciatis unde omnis iste natus error sit voluptatem
				accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore
				veritatis et quasi architecto beatae vitae dicta sunt explicabo.
			</Text>
			<Box className="mt-6 h-40 overflow-hidden rounded-xl bg-muted">
				<Image
					resizeMode="cover"
					className="h-full w-full"
					source={{ uri: `https://picsum.photos/seed/${props.seed + 10}/800/320` }}
				/>
			</Box>
		</Box>
	);
}

function TabItem(props: { tab: TabConfig; active: boolean; onPress: () => void }) {
	const isNative = Platform.OS !== "web";
	const progress = useSharedValue(isNative && !props.active ? 0 : 1);

	useEffect(() => {
		if (!isNative) {
			return;
		}
		progress.value = withTiming(props.active ? 1 : 0, { duration: 150 });
	}, [props.active, progress, isNative]);

	const labelStyle = useAnimatedStyle(() => ({
		overflow: "hidden",
		opacity: progress.value,
		marginLeft: interpolate(progress.value, [0, 1], [0, 8]),
		maxWidth: interpolate(progress.value, [0, 1], [0, 200]),
	}));

	const { Icon } = props.tab;
	const inactiveTextClassName =
		Platform.OS === "ios" ? "text-[rgba(255,255,255,0.82)]" : "text-[rgba(0,0,0,0.5)]";

	return (
		<Pressable
			onPress={props.onPress}
			className={clsx(
				"flex-row items-center rounded-full px-4 py-2",
				props.active && "bg-[rgba(201,148,58,0.22)]",
			)}
		>
			<Icon size={15} strokeWidth={2} color={props.active ? ACCENT : INACTIVE_COLOR} />
			<Animated.View style={labelStyle}>
				<Text
					numberOfLines={1}
					className={clsx(
						"text-[13px] font-sans-medium",
						props.active ? "text-[#C9943A]" : inactiveTextClassName,
					)}
				>
					{props.tab.label}
				</Text>
			</Animated.View>
		</Pressable>
	);
}

function TabBar(props: {
	tabs: TabConfig[];
	activeKey: string;
	onTabChange: (key: string) => void;
}) {
	const insets = useSafeAreaInsets();
	return (
		<Box
			pointerEvents="box-none"
			className="absolute bottom-0 left-0 right-0 items-center"
			style={{ paddingBottom: insets.bottom + 12 }}
		>
			<GlassView
				isInteractive
				colorScheme="dark"
				glassEffectStyle="regular"
				tintColor="rgba(10,10,14,0.55)"
				className="rounded-[50px] overflow-hidden android:border android:border-white/10 android:bg-card/90 web:bg-card/80 web:backdrop-blur-md"
			>
				<Box className="flex-row px-2 py-1.5">
					{props.tabs.map((tab) => (
						<TabItem
							tab={tab}
							key={tab.key}
							active={tab.key === props.activeKey}
							onPress={() => props.onTabChange(tab.key)}
						/>
					))}
				</Box>
			</GlassView>
		</Box>
	);
}

export function EntityDetailTabs(props: {
	entity: EntityDetail;
	groups: Groups | null;
	creators: UnlinkedCreator[];
	companies: RelatedCompany[];
	collections: Collections | null;
}) {
	const insets = useSafeAreaInsets();
	const [activeKey, setActiveKey] = useState("overview");

	const tabs = useMemo(() => {
		const typeTab = getTypeSpecificTab(props.entity);
		return [
			{ key: "overview", label: "Overview", Icon: BookOpen },
			...(typeTab ? [typeTab] : []),
			{ key: "history", label: "History", Icon: Clock },
			{ key: "similar", label: "Similar", Icon: Sparkles },
		] satisfies TabConfig[];
	}, [props.entity]);

	const tabContent = match(activeKey)
		.with("history", () => <PlaceholderTab seed={42} />)
		.with("seasons", "episodes", "schedule", "platforms", () => (
			<TypeSpecificTab entity={props.entity} />
		))
		.with("overview", () => (
			<OverviewTab
				groups={props.groups}
				entity={props.entity}
				creators={props.creators}
				companies={props.companies}
				collections={props.collections}
			/>
		))
		.otherwise(() => <PlaceholderTab seed={99} />);

	return (
		<Box className="flex-1 bg-background">
			<ScrollView
				showsVerticalScrollIndicator={false}
				contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
			>
				<HeroSection entity={props.entity} creators={props.creators} />
				<Animated.View key={activeKey} entering={FadeIn.duration(200)}>
					{tabContent}
				</Animated.View>
			</ScrollView>
			<TabBar tabs={tabs} activeKey={activeKey} onTabChange={setActiveKey} />
		</Box>
	);
}
