import { dayjs } from "@ryot/ts-utils";
import { ChevronDown, ChevronUp, Library } from "lucide-react-native";
import { useState } from "react";
import { Image, ScrollView } from "react-native";
import { match } from "ts-pattern";

import { Box } from "@/components/ui/box";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { hexToRgba } from "@/features/media/overview-utils";

import { formatMinutes, formatSeconds } from "./duration";
import { ExpandableText } from "./expandable-text";
import { formatRoleLabel, getPrimaryCreator } from "./people";
import type {
	EntityDetail,
	PodcastDetail,
	ShowDetail,
	UnlinkedCreator,
	VideoGameDetail,
} from "./types";
const ACCENT = "#C9943A";

function SectionLabel({ label }: { label: string }) {
	return (
		<Box className="mb-3 mt-7 flex-row items-center gap-3">
			<Box className="h-px flex-1" style={{ backgroundColor: hexToRgba(ACCENT, 0.3) }} />
			<Text
				className="text-xs font-sans-semibold uppercase tracking-[2px] web:text-[13px]"
				style={{ color: ACCENT }}
			>
				{label}
			</Text>
			<Box className="h-px flex-1" style={{ backgroundColor: hexToRgba(ACCENT, 0.3) }} />
		</Box>
	);
}

function StatBlock({ label, value }: { label: string; value: string }) {
	return (
		<Box
			className="flex-1 items-center rounded-xl py-3"
			style={{
				borderWidth: 1,
				borderColor: hexToRgba(ACCENT, 0.14),
				backgroundColor: hexToRgba(ACCENT, 0.07),
			}}
		>
			<Text className="text-[22px] font-heading-semibold web:text-[26px]" style={{ color: ACCENT }}>
				{value}
			</Text>
			<Text className="mt-0.5 text-[11px] font-sans-medium uppercase tracking-[1px] text-muted-foreground web:text-[13px]">
				{label}
			</Text>
		</Box>
	);
}

export function AboutSection({ entity }: { entity: EntityDetail }) {
	if (!entity.description) {
		return null;
	}

	const primaryCreator = getPrimaryCreator(entity);
	const creatorLabel = match(entity.entitySchemaSlug)
		.with("show", () => "Created by")
		.with("podcast", () => "Hosted by")
		.with("movie", () => "Directed by")
		.with("book", "comic-book", "audiobook", () => "Written by")
		.otherwise(() => "By");

	return (
		<Box>
			<ExpandableText
				toggleTextStyle={{ color: ACCENT }}
				className="text-[15px] font-sans leading-[1.7] text-muted-foreground web:text-[17px]"
			>
				{entity.description}
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

export function CreatorsSection({ creators }: { creators: UnlinkedCreator[] }) {
	if (creators.length === 0) {
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
				{creators.map((c) => (
					<Box key={c.id ?? `${c.name}-${c.role}`} className="items-center" style={{ width: 110 }}>
						<Box
							className="overflow-hidden rounded-lg"
							style={{
								width: 80,
								height: 80,
								backgroundColor: hexToRgba(ACCENT, 0.07),
							}}
						>
							{c.image ? (
								<Image source={{ uri: c.image }} className="h-full w-full" resizeMode="cover" />
							) : null}
						</Box>
						<Text
							numberOfLines={1}
							className="mt-2 text-center text-[13px] font-sans-semibold text-foreground web:text-[15px]"
						>
							{c.name}
						</Text>
						<Text
							numberOfLines={1}
							className="mt-0.5 text-center text-[11px] italic text-muted-foreground web:text-[13px]"
						>
							{formatRoleLabel(c.role)}
						</Text>
					</Box>
				))}
			</ScrollView>
		</Box>
	);
}

export function CollectionsSection({
	collections,
}: {
	collections: Array<{ id: string; name: string }> | null;
}) {
	if (!collections || collections.length === 0) {
		return null;
	}

	return (
		<Box className="mt-8">
			<Text className="mb-3 font-heading-semibold text-[16px] text-foreground web:text-[18px]">
				Collections
			</Text>
			<Box className="flex-row flex-wrap gap-2">
				{collections.map((collection) => (
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

function DetailRow({ label, value }: { label: string; value: string }) {
	return (
		<Box className="flex-row justify-between py-2">
			<Text className="text-[13px] text-muted-foreground web:text-[15px]">{label}</Text>
			<Text className="text-[13px] font-sans-medium text-foreground web:text-[15px]">{value}</Text>
		</Box>
	);
}

export function DetailsSection({ entity }: { entity: EntityDetail }) {
	const rows: { label: string; value: string }[] = [];
	const pc = getPrimaryCreator(entity);

	if (entity.publishYear) {
		rows.push({ label: "Year", value: String(entity.publishYear) });
	}

	switch (entity.entitySchemaSlug) {
		case "movie":
		case "audiobook":
			if (entity.runtime) {
				rows.push({ label: "Runtime", value: formatMinutes(entity.runtime) });
			}
			break;
		case "show": {
			const eps = entity.showSeasons.reduce((n, s) => n + s.episodes.length, 0);
			rows.push(
				{ label: "Seasons", value: String(entity.showSeasons.length) },
				{ label: "Episodes", value: String(eps) },
			);
			break;
		}
		case "anime":
			if (entity.episodes) {
				rows.push({ label: "Episodes", value: String(entity.episodes) });
			}
			break;
		case "manga":
			if (entity.volumes) {
				rows.push({ label: "Volumes", value: String(entity.volumes) });
			}
			if (entity.chapters) {
				rows.push({ label: "Chapters", value: String(entity.chapters) });
			}
			break;
		case "book":
			if (entity.pages) {
				rows.push({ label: "Pages", value: String(entity.pages) });
			}
			if (entity.isCompilation) {
				rows.push({ label: "Compilation", value: "Yes" });
			}
			break;
		case "comic-book":
			if (entity.pages) {
				rows.push({ label: "Pages", value: String(entity.pages) });
			}
			break;
		case "podcast":
			if (entity.totalEpisodes) {
				rows.push({
					label: "Episodes",
					value: String(entity.totalEpisodes),
				});
			}
			break;
		case "music":
			if (entity.duration) {
				rows.push({
					label: "Duration",
					value: formatSeconds(entity.duration),
				});
			}
			if (entity.byVariousArtists) {
				rows.push({ label: "Artists", value: "Various" });
			}
			break;
		case "video-game":
			if (entity.timeToBeat?.normally) {
				rows.push({
					label: "Time to Beat",
					value: formatMinutes(entity.timeToBeat.normally),
				});
			}
			break;
		case "visual-novel":
			if (entity.lengthMinutes) {
				rows.push({
					label: "Est. Length",
					value: formatMinutes(entity.lengthMinutes),
				});
			}
			break;
	}

	if (pc) {
		const label =
			entity.entitySchemaSlug === "movie"
				? "Director"
				: entity.entitySchemaSlug === "show"
					? "Creator"
					: entity.entitySchemaSlug === "podcast"
						? "Host"
						: "Author";
		rows.push({ label, value: pc.name });
	}

	if (entity.productionStatus) {
		rows.push({ label: "Status", value: entity.productionStatus });
	}
	if (entity.providerRating) {
		rows.push({ label: "Rating", value: entity.providerRating.toFixed(1) });
	}
	if (entity.isNsfw) {
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
			{rows.map((r, i) => (
				<Box key={r.label}>
					{i > 0 && <Box className="h-px bg-border" />}
					<DetailRow label={r.label} value={r.value} />
				</Box>
			))}
		</Box>
	);
}

function ShowSeasonsList({ entity }: { entity: ShowDetail }) {
	const [openId, setOpenId] = useState<number | null>(null);

	return (
		<Box>
			<SectionLabel label="Seasons" />
			{entity.showSeasons.map((season) => {
				const isOpen = openId === season.id;
				return (
					<Box key={season.id} className="mb-2">
						<Pressable
							className="flex-row items-center justify-between rounded-xl px-4 py-3"
							style={{
								backgroundColor: hexToRgba(ACCENT, 0.07),
								borderWidth: 1,
								borderColor: hexToRgba(ACCENT, 0.14),
							}}
							onPress={() => setOpenId(isOpen ? null : season.id)}
						>
							<Box>
								<Text className="text-[14px] font-sans-semibold text-foreground web:text-[16px]">
									{season.name}
								</Text>
								<Text className="mt-0.5 text-[12px] font-mono text-muted-foreground web:text-[14px]">
									{season.episodes.length} episodes
									{season.publishDate ? ` · ${dayjs(season.publishDate).format("YYYY")}` : ""}
								</Text>
							</Box>
							{isOpen ? (
								<ChevronUp size={16} color={ACCENT} strokeWidth={2} />
							) : (
								<ChevronDown size={16} color={ACCENT} strokeWidth={2} />
							)}
						</Pressable>
						{isOpen && (
							<Box
								className="mx-1 rounded-b-xl px-4 pb-2"
								style={{ backgroundColor: hexToRgba(ACCENT, 0.04) }}
							>
								{season.episodes.map((ep) => (
									<Box
										key={ep.id}
										className="flex-row items-baseline justify-between border-b py-2.5"
										style={{ borderColor: hexToRgba(ACCENT, 0.1) }}
									>
										<Text className="mr-2 w-8 text-[12px] font-mono text-muted-foreground web:text-[14px]">
											{`E${String(ep.episodeNumber).padStart(2, "0")}`}
										</Text>
										<Text
											className="flex-1 text-[13px] font-sans text-foreground web:text-[15px]"
											numberOfLines={1}
										>
											{ep.name}
										</Text>
										{ep.runtime ? (
											<Text className="ml-2 text-[12px] font-mono text-muted-foreground web:text-[14px]">
												{formatMinutes(ep.runtime)}
											</Text>
										) : null}
									</Box>
								))}
							</Box>
						)}
					</Box>
				);
			})}
		</Box>
	);
}

function PodcastEpisodesList({ entity }: { entity: PodcastDetail }) {
	return (
		<Box>
			<SectionLabel label="Episodes" />
			{entity.episodes.map((ep) => (
				<Box
					key={ep.id}
					className="flex-row items-start border-b py-3"
					style={{ borderColor: hexToRgba(ACCENT, 0.12) }}
				>
					<Text className="mr-3 w-8 text-[13px] font-mono text-muted-foreground web:text-[15px]">
						{ep.number}
					</Text>
					<Box className="flex-1">
						<Text
							className="text-[13px] font-sans-medium text-foreground web:text-[15px]"
							numberOfLines={2}
						>
							{ep.title}
						</Text>
						<Box className="mt-1 flex-row gap-3">
							<Text className="text-[11px] font-mono text-muted-foreground web:text-[13px]">
								{dayjs(ep.publishDate).format("MMM D, YYYY")}
							</Text>
							{ep.runtime ? (
								<Text className="text-[11px] font-mono text-muted-foreground web:text-[13px]">
									{formatMinutes(ep.runtime)}
								</Text>
							) : null}
						</Box>
					</Box>
				</Box>
			))}
		</Box>
	);
}

function VideoGameStats({ entity }: { entity: VideoGameDetail }) {
	return (
		<Box>
			{entity.timeToBeat && (
				<Box>
					<SectionLabel label="Time to Beat" />
					<Box className="flex-row gap-3">
						{entity.timeToBeat.hastily ? (
							<StatBlock label="Rushed" value={formatMinutes(entity.timeToBeat.hastily)} />
						) : null}
						{entity.timeToBeat.normally ? (
							<StatBlock label="Normal" value={formatMinutes(entity.timeToBeat.normally)} />
						) : null}
						{entity.timeToBeat.completely ? (
							<StatBlock label="100%" value={formatMinutes(entity.timeToBeat.completely)} />
						) : null}
					</Box>
				</Box>
			)}
			{entity.platformReleases && entity.platformReleases.length > 0 && (
				<Box>
					<SectionLabel label="Platforms" />
					{entity.platformReleases.map((p) => (
						<Box
							key={p.name}
							className="mb-2 flex-row items-center justify-between rounded-xl px-4 py-3"
							style={{
								backgroundColor: hexToRgba(ACCENT, 0.07),
								borderWidth: 1,
								borderColor: hexToRgba(ACCENT, 0.14),
							}}
						>
							<Text className="text-[13px] font-sans-medium text-foreground web:text-[15px]">
								{p.name}
							</Text>
							{p.releaseDate ? (
								<Text className="text-[12px] font-mono text-muted-foreground web:text-[14px]">
									{dayjs(p.releaseDate).format("MMM D, YYYY")}
								</Text>
							) : null}
						</Box>
					))}
				</Box>
			)}
		</Box>
	);
}

export function TypeSpecificSection({ entity }: { entity: EntityDetail }) {
	return match(entity)
		.with({ entitySchemaSlug: "show" }, (e) => <ShowSeasonsList entity={e} />)
		.with({ entitySchemaSlug: "video-game" }, (e) => <VideoGameStats entity={e} />)
		.with({ entitySchemaSlug: "podcast" }, (e) => <PodcastEpisodesList entity={e} />)
		.with({ entitySchemaSlug: "anime" }, (e) => (
			<Box>
				{e.airingSchedule && e.airingSchedule.length > 0 && (
					<Box>
						<SectionLabel label="Airing Schedule" />
						{e.airingSchedule.map((item) => (
							<Box
								key={item.episode}
								className="mb-2 flex-row items-center justify-between rounded-xl px-4 py-3"
								style={{
									borderWidth: 1,
									borderColor: hexToRgba(ACCENT, 0.14),
									backgroundColor: hexToRgba(ACCENT, 0.07),
								}}
							>
								<Text className="text-[13px] font-sans-medium text-foreground web:text-[15px]">
									{`Episode ${item.episode}`}
								</Text>
								<Text className="text-[12px] font-mono text-muted-foreground web:text-[14px]">
									{dayjs(item.airingAt).format("MMM D, YYYY")}
								</Text>
							</Box>
						))}
					</Box>
				)}
			</Box>
		))
		.otherwise(() => null);
}
