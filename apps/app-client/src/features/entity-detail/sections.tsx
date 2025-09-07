import { dayjs } from "@ryot/ts-utils";
import { Layers, Library } from "lucide-react-native";
import { Image, ScrollView } from "react-native";
import { match } from "ts-pattern";

import { Box } from "@/components/ui/box";
import { Text } from "@/components/ui/text";
import { hexToRgba } from "@/features/media/overview-utils";

import type { RelatedCompany } from "./companies";
import { formatMinutes, formatSeconds } from "./duration";
import { ExpandableText } from "./expandable-text";
import { formatRoleLabel, getPrimaryCreator } from "./people";
import type { EntityDetail, UnlinkedCreator } from "./types";

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

export function CompaniesSection(props: { companies: RelatedCompany[] }) {
	if (props.companies.length === 0) {
		return null;
	}

	return (
		<Box className="mt-8">
			<Text className="mb-3 font-heading-semibold text-[16px] text-foreground web:text-[18px]">
				Companies
			</Text>
			<ScrollView
				horizontal
				contentContainerStyle={{ gap: 16 }}
				showsHorizontalScrollIndicator={false}
			>
				{props.companies.map((company) => {
					const imageUrl = company.image?.type === "remote" ? company.image.url : null;
					return (
						<Box
							key={company.id ?? `${company.name}-${company.role}`}
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
								{company.name}
							</Text>
							<Text
								numberOfLines={1}
								className="mt-0.5 text-center text-[11px] italic text-muted-foreground web:text-[13px]"
							>
								{formatRoleLabel(company.role)}
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

const GROUP_SECTION_LABEL: Record<string, string> = {
	book: "Series",
	movie: "Series",
	music: "Albums",
	audiobook: "Series",
	"comic-book": "Series",
	"video-game": "Franchises",
};

export function GroupsSection(props: {
	groups: Array<{ id: string; name: string }> | null;
	entitySchemaSlug: string;
}) {
	if (!props.groups || props.groups.length === 0) {
		return null;
	}

	const label = GROUP_SECTION_LABEL[props.entitySchemaSlug] ?? "Groups";

	return (
		<Box className="mt-8">
			<Text className="mb-3 font-heading-semibold text-[16px] text-foreground web:text-[18px]">
				{label}
			</Text>
			<Box className="flex-row flex-wrap gap-2">
				{props.groups.map((group) => (
					<Box
						key={group.id}
						className="flex-row items-center gap-2 rounded-full bg-muted px-3 py-2"
					>
						<Layers size={14} color={ACCENT} strokeWidth={2} />
						<Text className="text-[13px] font-sans-medium text-foreground web:text-[15px]">
							{group.name}
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

	if (entity.properties.publishDate != null) {
		rows.push({
			label: "Released",
			value: dayjs(entity.properties.publishDate).format("MMMM D, YYYY"),
		});
	} else if (entity.properties.publishYear != null) {
		rows.push({ label: "Year", value: String(entity.properties.publishYear) });
	}

	rows.push(
		...match(entity)
			.with({ entitySchemaSlug: "movie" }, (movie) =>
				movie.properties.runtime != null
					? [{ label: "Runtime", value: formatMinutes(movie.properties.runtime) }]
					: [],
			)
			.with({ entitySchemaSlug: "audiobook" }, (audiobook) =>
				audiobook.properties.runtime != null
					? [{ label: "Runtime", value: formatMinutes(audiobook.properties.runtime) }]
					: [],
			)
			.with({ entitySchemaSlug: "show" }, (show) => {
				const episodes = show.properties.showSeasons.reduce(
					(count: number, season) => count + season.episodes.length,
					0,
				);
				return [
					{ label: "Seasons", value: String(show.properties.showSeasons.length) },
					{ label: "Episodes", value: String(episodes) },
				];
			})
			.with({ entitySchemaSlug: "anime" }, (anime) =>
				anime.properties.episodes != null
					? [{ label: "Episodes", value: String(anime.properties.episodes) }]
					: [],
			)
			.with({ entitySchemaSlug: "manga" }, (manga) => [
				...(manga.properties.volumes != null
					? [{ label: "Volumes", value: String(manga.properties.volumes) }]
					: []),
				...(manga.properties.chapters != null
					? [{ label: "Chapters", value: String(manga.properties.chapters) }]
					: []),
			])
			.with({ entitySchemaSlug: "book" }, (book) => [
				...(book.properties.pages != null
					? [{ label: "Pages", value: String(book.properties.pages) }]
					: []),
				...(book.properties.isCompilation ? [{ label: "Compilation", value: "Yes" }] : []),
			])
			.with({ entitySchemaSlug: "comic-book" }, (comicBook) =>
				comicBook.properties.pages != null
					? [{ label: "Pages", value: String(comicBook.properties.pages) }]
					: [],
			)
			.with({ entitySchemaSlug: "podcast" }, (podcast) =>
				podcast.properties.totalEpisodes != null
					? [{ label: "Episodes", value: String(podcast.properties.totalEpisodes) }]
					: [],
			)
			.with({ entitySchemaSlug: "music" }, (music) => [
				...(music.properties.duration != null
					? [{ label: "Duration", value: formatSeconds(music.properties.duration) }]
					: []),
				...(music.properties.byVariousArtists ? [{ label: "Artists", value: "Various" }] : []),
			])
			.with({ entitySchemaSlug: "video-game" }, (videoGame) =>
				videoGame.properties.timeToBeat?.normally != null
					? [
							{
								label: "Time to Beat",
								value: formatMinutes(videoGame.properties.timeToBeat.normally),
							},
						]
					: [],
			)
			.with({ entitySchemaSlug: "visual-novel" }, (visualNovel) =>
				visualNovel.properties.lengthMinutes != null
					? [{ label: "Est. Length", value: formatMinutes(visualNovel.properties.lengthMinutes) }]
					: [],
			)
			.otherwise(() => []),
	);

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
