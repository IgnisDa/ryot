import clsx from "clsx";
import { GlassView } from "expo-glass-effect";
import { BookOpen, Clock, Sparkles } from "lucide-react-native";
import { useState } from "react";
import { Image, Platform, ScrollView } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { match } from "ts-pattern";

import { Box } from "@/components/ui/box";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";

import type { loadRelatedCollections } from "./collections";
import { HeroSection } from "./hero-section";
import {
	AboutSection,
	CollectionsSection,
	CreatorsSection,
	DetailsSection,
	TypeSpecificSection,
} from "./sections";
import type { EntityDetail, UnlinkedCreator } from "./types";

type Collections = Awaited<ReturnType<typeof loadRelatedCollections>>;

const ACCENT = "#C9943A";
const INACTIVE_COLOR = Platform.select({
	ios: "rgba(255,255,255,0.82)",
	default: "rgba(0,0,0,0.5)",
});

const TABS = [
	{ key: "overview", label: "Overview", Icon: BookOpen },
	{ key: "history", label: "History", Icon: Clock },
	{ key: "similar", label: "Similar", Icon: Sparkles },
] as const;

function OverviewTab(props: {
	entity: EntityDetail;
	creators: UnlinkedCreator[];
	collections: Collections | null;
}) {
	return (
		<Box className="web:mx-auto web:max-w-7xl">
			<Box className="px-7 pt-8 md:grid md:grid-cols-[2fr_1fr] md:items-start md:gap-10 md:px-10">
				<Box>
					<AboutSection entity={props.entity} creators={props.creators} />
					<CreatorsSection creators={props.creators} />
					<TypeSpecificSection entity={props.entity} />
				</Box>
				<Box>
					<DetailsSection entity={props.entity} creators={props.creators} />
					<CollectionsSection collections={props.collections} />
				</Box>
			</Box>
		</Box>
	);
}

function PlaceholderTab(props: { seed: number }) {
	return (
		<Box className="px-7 pt-8 web:mx-auto web:max-w-7xl">
			<Box className="mb-6 overflow-hidden rounded-xl bg-muted" style={{ height: 200 }}>
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
			<Box className="mt-6 overflow-hidden rounded-xl bg-muted" style={{ height: 160 }}>
				<Image
					resizeMode="cover"
					className="h-full w-full"
					source={{ uri: `https://picsum.photos/seed/${props.seed + 10}/800/320` }}
				/>
			</Box>
		</Box>
	);
}

function TabBar(props: { activeIndex: number; onTabChange: (i: number) => void }) {
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
				style={{ borderRadius: 50, overflow: "hidden" }}
				className="android:border android:border-white/10 android:bg-card/90 web:bg-card/80 web:backdrop-blur-md"
			>
				<Box className="flex-row px-2 py-1.5">
					{TABS.map((tab, i) => {
						const active = i === props.activeIndex;
						const { Icon } = tab;
						return (
							<Pressable
								key={tab.key}
								onPress={() => props.onTabChange(i)}
								className={clsx(
									"flex-row items-center gap-2 rounded-full px-4 py-2",
									active && "bg-[rgba(201,148,58,0.22)]",
								)}
							>
								<Icon size={15} strokeWidth={2} color={active ? ACCENT : INACTIVE_COLOR} />
								<Text
									className="text-[13px] font-sans-medium"
									style={{ color: active ? ACCENT : INACTIVE_COLOR }}
								>
									{tab.label}
								</Text>
							</Pressable>
						);
					})}
				</Box>
			</GlassView>
		</Box>
	);
}

export function EntityDetailTabs(props: {
	entity: EntityDetail;
	creators: UnlinkedCreator[];
	collections: Collections | null;
}) {
	const insets = useSafeAreaInsets();
	const [activeIndex, setActiveIndex] = useState(0);

	const tabContent = match(activeIndex)
		.with(0, () => (
			<OverviewTab
				entity={props.entity}
				creators={props.creators}
				collections={props.collections}
			/>
		))
		.with(1, () => <PlaceholderTab seed={42} />)
		.otherwise(() => <PlaceholderTab seed={99} />);

	return (
		<Box className="flex-1 bg-background">
			<ScrollView
				showsVerticalScrollIndicator={false}
				contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
			>
				<HeroSection entity={props.entity} creators={props.creators} />
				<Animated.View key={activeIndex} entering={FadeIn.duration(200)}>
					{tabContent}
				</Animated.View>
			</ScrollView>
			<TabBar activeIndex={activeIndex} onTabChange={setActiveIndex} />
		</Box>
	);
}
