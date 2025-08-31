import { changeCase } from "@ryot/ts-utils";
import clsx from "clsx";
import { Layers } from "lucide-react-native";
import { useState } from "react";
import { ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Box } from "@/components/ui/box";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { MEDIA_SCOPE_SLUGS } from "@/features/media/constants";

import { FAKE_ENTITY_DATA } from "./fake-data";
import { HeroSection } from "./hero-section";
import {
	AboutSection,
	CollectionsSection,
	CreatorsSection,
	DetailsSection,
	TypeSpecificSection,
} from "./sections";
import type { EntityDetail } from "./types";

// Slugs that have fake data (excludes "person" which is not a media entity type yet)
const DEMO_SLUGS = MEDIA_SCOPE_SLUGS.filter((s) => FAKE_ENTITY_DATA[s] !== undefined);

function hasUnlinkedCreators(entity: EntityDetail) {
	return "unlinkedCreators" in entity;
}

function TypeSwitcherFab({
	onSelect,
	activeSlug,
}: {
	activeSlug: string;
	onSelect: (slug: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const insets = useSafeAreaInsets();

	return (
		<Box
			style={{
				alignItems: "flex-end",
				bottom: insets.bottom + 16,
				position: "absolute",
				right: 20,
			}}
		>
			{open && (
				<ScrollView
					showsVerticalScrollIndicator={false}
					style={{ maxHeight: 300, marginBottom: 8 }}
					contentContainerStyle={{ gap: 6, alignItems: "flex-end" }}
				>
					{DEMO_SLUGS.map((slug) => (
						<Pressable
							key={slug}
							onPress={() => {
								onSelect(slug);
								setOpen(false);
							}}
							className={clsx(
								"rounded-full px-3 py-2",
								slug === activeSlug ? "bg-[#C9943A]" : "bg-stone-800",
							)}
						>
							<Text
								className={clsx(
									"text-[13px] font-sans-medium web:text-[15px]",
									slug === activeSlug ? "text-[#1c1917]" : "text-[#d6d3d1]",
								)}
							>
								{changeCase(slug)}
							</Text>
						</Pressable>
					))}
				</ScrollView>
			)}
			<Pressable
				className="rounded-full bg-[#C9943A] p-3 shadow-lg"
				accessibilityLabel="Switch entity type"
				accessibilityRole="button"
				onPress={() => setOpen((v) => !v)}
			>
				<Layers color="#1c1917" size={20} strokeWidth={2} />
			</Pressable>
		</Box>
	);
}

export function EntityDetailScreen() {
	const [activeSlug, setActiveSlug] = useState("book");
	const insets = useSafeAreaInsets();
	const entity = FAKE_ENTITY_DATA[activeSlug];

	if (!entity) {
		return null;
	}

	return (
		<Box className="flex-1 bg-background">
			<ScrollView
				showsVerticalScrollIndicator={false}
				contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
			>
				<HeroSection entity={entity} />
				<Box className="web:mx-auto web:max-w-7xl">
					<Box className="px-7 pt-8 md:grid md:grid-cols-[2fr_1fr] md:items-start md:gap-10 md:px-10">
						<Box>
							<AboutSection entity={entity} />
							{hasUnlinkedCreators(entity) && (
								<CreatorsSection creators={entity.unlinkedCreators} />
							)}
							<TypeSpecificSection entity={entity} />
						</Box>
						<Box>
							<DetailsSection entity={entity} />
							<CollectionsSection collections={entity.collections} />
						</Box>
					</Box>
				</Box>
			</ScrollView>
			<TypeSwitcherFab activeSlug={activeSlug} onSelect={setActiveSlug} />
		</Box>
	);
}
