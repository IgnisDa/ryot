import { Library } from "lucide-react-native";
import { Image, ScrollView } from "react-native";

import { Box } from "@/components/ui/box";
import { Text } from "@/components/ui/text";
import { hexToRgba } from "@/features/media/overview-utils";

import { formatMinutes, formatSeconds } from "./duration";
import { ExpandableText } from "./expandable-text";
import { formatRoleLabel, getPrimaryCreator } from "./people";
import type { EntityDetail, UnlinkedCreator } from "./types";
export { TypeSpecificSection } from "./type-specific-sections";

const ACCENT = "#C9943A";

export function AboutSection(props: { creators: UnlinkedCreator[]; entity: EntityDetail }) {
	const description = props.entity.properties.description;
	if (!description) {
		return null;
	}

	const primaryCreator = getPrimaryCreator(props.creators);
	const creatorLabel =
		props.entity.entitySchemaSlug === "show"
			? "Created by"
			: props.entity.entitySchemaSlug === "podcast"
				? "Hosted by"
				: props.entity.entitySchemaSlug === "movie"
					? "Directed by"
					: props.entity.entitySchemaSlug === "book" ||
						  props.entity.entitySchemaSlug === "comic-book" ||
						  props.entity.entitySchemaSlug === "audiobook"
						? "Written by"
						: "By";

	return (
		<Box>
			<ExpandableText
				toggleTextStyle={{ color: ACCENT }}
				className="text-[15px] font-sans leading-[1.7] text-muted-foreground web:text-[17px]"
			>
				{description}
			</ExpandableText>
			{primaryCreator && (
				<Box className="mt-6 flex-row items-center gap-3 border-t border-border pt-4">
					<Box>
						<Text className="text-[11px] font-sans uppercase tracking-[0.06em] text-muted-foreground web:text-[13px]">
							{creatorLabel}
						</Text>
						<Text className="mt-0.5 font-heading-semibold text-[16px] text-foreground web:text-[18px]">
							{primaryCreator.name}
						</Text>
					</Box>
				</Box>
			)}
		</Box>
	);
}

export function CreatorsSection(props: { creators: UnlinkedCreator[] }) {
	if (props.creators.length === 0) {
		return null;
	}

	return (
		<Box className="mt-8">
			<Text className="mb-3 font-heading-semibold text-[16px] text-foreground web:text-[18px]">
				People
			</Text>
			<ScrollView
				horizontal
				contentContainerStyle={{ gap: 16 }}
				showsHorizontalScrollIndicator={false}
			>
				{props.creators.map((creator) => {
					const imageUrl = creator.image?.type === "remote" ? creator.image.url : null;
					return (
						<Box
							key={creator.id ?? `${creator.name}-${creator.role}`}
							className="items-center"
							style={{ width: 110 }}
						>
							<Box
								className="overflow-hidden rounded-lg"
								style={{
									width: 80,
									height: 80,
									backgroundColor: hexToRgba(ACCENT, 0.07),
								}}
							>
								{imageUrl ? (
									<Image source={{ uri: imageUrl }} className="h-full w-full" resizeMode="cover" />
								) : null}
							</Box>
							<Text
								numberOfLines={1}
								className="mt-2 text-center text-[13px] font-sans-semibold text-foreground web:text-[15px]"
							>
								{creator.name}
							</Text>
							<Text
								numberOfLines={1}
								className="mt-0.5 text-center text-[11px] italic text-muted-foreground web:text-[13px]"
							>
								{formatRoleLabel(creator.role)}
							</Text>
						</Box>
					);
				})}
			</ScrollView>
		</Box>
	);
}

export function CollectionsSection(props: {
	collections: Array<{ id: string; name: string }> | null;
}) {
	if (!props.collections || props.collections.length === 0) {
		return null;
	}

	return (
		<Box className="mt-8">
			<Text className="mb-3 font-heading-semibold text-[16px] text-foreground web:text-[18px]">
				Collections
			</Text>
			<Box className="flex-row flex-wrap gap-2">
				{props.collections.map((collection) => (
					<Box
						key={collection.id}
						className="flex-row items-center gap-2 rounded-full bg-muted px-3 py-2"
					>
						<Library size={14} color={ACCENT} strokeWidth={2} />
						<Text className="text-[13px] font-sans-medium text-foreground web:text-[15px]">
							{collection.name}
						</Text>
					</Box>
				))}
			</Box>
		</Box>
	);
}

function DetailRow(props: { label: string; value: string }) {
	return (
		<Box className="flex-row justify-between py-2">
			<Text className="text-[13px] text-muted-foreground web:text-[15px]">{props.label}</Text>
			<Text className="text-[13px] font-sans-medium text-foreground web:text-[15px]">
				{props.value}
			</Text>
		</Box>
	);
}

export function DetailsSection(props: { creators: UnlinkedCreator[]; entity: EntityDetail }) {
	const entity = props.entity;
	const rows: { label: string; value: string }[] = [];
	const primaryCreator = getPrimaryCreator(props.creators);

	if (entity.properties.publishYear != null) {
		rows.push({ label: "Year", value: String(entity.properties.publishYear) });
	}

	switch (entity.entitySchemaSlug) {
		case "movie":
		case "audiobook":
			if ("runtime" in entity.properties && entity.properties.runtime != null) {
				rows.push({ label: "Runtime", value: formatMinutes(entity.properties.runtime) });
			}
			break;
		case "show": {
			const episodes = entity.properties.showSeasons.reduce(
				(count, season) => count + season.episodes.length,
				0,
			);
			rows.push({ label: "Seasons", value: String(entity.properties.showSeasons.length) });
			rows.push({ label: "Episodes", value: String(episodes) });
			break;
		}
		case "anime":
			if (entity.properties.episodes != null) {
				rows.push({ label: "Episodes", value: String(entity.properties.episodes) });
			}
			break;
		case "manga":
			if (entity.properties.volumes != null) {
				rows.push({ label: "Volumes", value: String(entity.properties.volumes) });
			}
			if (entity.properties.chapters != null) {
				rows.push({ label: "Chapters", value: String(entity.properties.chapters) });
			}
			break;
		case "book":
			if (entity.properties.pages != null) {
				rows.push({ label: "Pages", value: String(entity.properties.pages) });
			}
			if (entity.properties.isCompilation) {
				rows.push({ label: "Compilation", value: "Yes" });
			}
			break;
		case "comic-book":
			if (entity.properties.pages != null) {
				rows.push({ label: "Pages", value: String(entity.properties.pages) });
			}
			break;
		case "podcast":
			if (entity.properties.totalEpisodes != null) {
				rows.push({ label: "Episodes", value: String(entity.properties.totalEpisodes) });
			}
			break;
		case "music":
			if (entity.properties.duration != null) {
				rows.push({ label: "Duration", value: formatSeconds(entity.properties.duration) });
			}
			if (entity.properties.byVariousArtists) {
				rows.push({ label: "Artists", value: "Various" });
			}
			break;
		case "video-game":
			if (entity.properties.timeToBeat?.normally != null) {
				rows.push({
					label: "Time to Beat",
					value: formatMinutes(entity.properties.timeToBeat.normally),
				});
			}
			break;
		case "visual-novel":
			if (entity.properties.lengthMinutes != null) {
				rows.push({ label: "Est. Length", value: formatMinutes(entity.properties.lengthMinutes) });
			}
			break;
	}

	if (primaryCreator) {
		const label =
			props.entity.entitySchemaSlug === "movie"
				? "Director"
				: props.entity.entitySchemaSlug === "show"
					? "Creator"
					: props.entity.entitySchemaSlug === "podcast"
						? "Host"
						: "Author";
		rows.push({ label, value: primaryCreator.name });
	}

	if (entity.properties.productionStatus) {
		rows.push({ label: "Status", value: entity.properties.productionStatus });
	}
	if (entity.properties.providerRating != null) {
		rows.push({ label: "Rating", value: entity.properties.providerRating.toFixed(1) });
	}
	if (entity.properties.isNsfw) {
		rows.push({ label: "NSFW", value: "Yes" });
	}

	if (rows.length === 0) {
		return null;
	}

	return (
		<Box className="mt-8">
			<Text className="mb-3 font-heading-semibold text-[16px] text-foreground web:text-[18px]">
				Details
			</Text>
			{rows.map((row, index) => (
				<Box key={row.label}>
					{index > 0 && <Box className="h-px bg-border" />}
					<DetailRow label={row.label} value={row.value} />
				</Box>
			))}
		</Box>
	);
}
