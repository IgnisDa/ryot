import { dayjs } from "@ryot/ts-utils";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { useState } from "react";

import { Box } from "@/components/ui/box";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { hexToRgba } from "@/features/media/overview-utils";

import { formatMinutes } from "./duration";
import type { AnimeDetail, PodcastDetail, ShowDetail, VideoGameDetail } from "./types";

const ACCENT = "#C9943A";

function SectionLabel(props: { label: string }) {
	return (
		<Box className="mb-3 mt-7 flex-row items-center gap-3">
			<Box className="h-px flex-1" style={{ backgroundColor: hexToRgba(ACCENT, 0.3) }} />
			<Text
				style={{ color: ACCENT }}
				className="text-xs font-sans-semibold uppercase tracking-[2px] web:text-[13px]"
			>
				{props.label}
			</Text>
			<Box className="h-px flex-1" style={{ backgroundColor: hexToRgba(ACCENT, 0.3) }} />
		</Box>
	);
}

function StatBlock(props: { label: string; value: string }) {
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
				{props.value}
			</Text>
			<Text className="mt-0.5 text-[11px] font-sans-medium uppercase tracking-[1px] text-muted-foreground web:text-[13px]">
				{props.label}
			</Text>
		</Box>
	);
}

export function ShowSeasonsList(props: { entity: ShowDetail }) {
	const [openId, setOpenId] = useState<number | null>(null);
	const seasons = props.entity.properties.showSeasons;

	return (
		<Box>
			<SectionLabel label="Seasons" />
			{seasons.map((season) => {
				const isOpen = openId === season.id;
				return (
					<Box key={season.id} className="mb-2">
						<Pressable
							className="flex-row items-center justify-between rounded-xl px-4 py-3"
							style={{
								borderWidth: 1,
								borderColor: hexToRgba(ACCENT, 0.14),
								backgroundColor: hexToRgba(ACCENT, 0.07),
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
								{season.episodes.map((episode) => (
									<Box
										key={episode.id}
										className="flex-row items-baseline justify-between border-b py-2.5"
										style={{ borderColor: hexToRgba(ACCENT, 0.1) }}
									>
										<Text className="mr-2 w-8 text-[12px] font-mono text-muted-foreground web:text-[14px]">
											{`E${String(episode.episodeNumber).padStart(2, "0")}`}
										</Text>
										<Text
											numberOfLines={1}
											className="flex-1 text-[13px] font-sans text-foreground web:text-[15px]"
										>
											{episode.name}
										</Text>
										{episode.runtime != null ? (
											<Text className="ml-2 text-[12px] font-mono text-muted-foreground web:text-[14px]">
												{formatMinutes(episode.runtime)}
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

export function PodcastEpisodesList(props: { entity: PodcastDetail }) {
	const episodes = props.entity.properties.episodes;

	return (
		<Box>
			<SectionLabel label="Episodes" />
			{episodes.map((episode) => (
				<Box
					key={episode.id}
					className="flex-row items-start border-b py-3"
					style={{ borderColor: hexToRgba(ACCENT, 0.12) }}
				>
					<Text className="mr-3 w-8 text-[13px] font-mono text-muted-foreground web:text-[15px]">
						{episode.number}
					</Text>
					<Box className="flex-1">
						<Text
							numberOfLines={2}
							className="text-[13px] font-sans-medium text-foreground web:text-[15px]"
						>
							{episode.title}
						</Text>
						<Box className="mt-1 flex-row gap-3">
							<Text className="text-[11px] font-mono text-muted-foreground web:text-[13px]">
								{dayjs(episode.publishDate).format("MMM D, YYYY")}
							</Text>
							{episode.runtime != null ? (
								<Text className="text-[11px] font-mono text-muted-foreground web:text-[13px]">
									{formatMinutes(episode.runtime)}
								</Text>
							) : null}
						</Box>
					</Box>
				</Box>
			))}
		</Box>
	);
}

export function VideoGameStats(props: { entity: VideoGameDetail }) {
	const timeToBeat = props.entity.properties.timeToBeat;
	const platformReleases = props.entity.properties.platformReleases;

	return (
		<Box>
			{timeToBeat && (
				<Box>
					<SectionLabel label="Time to Beat" />
					<Box className="flex-row gap-3">
						{timeToBeat.hastily != null ? (
							<StatBlock label="Rushed" value={formatMinutes(timeToBeat.hastily)} />
						) : null}
						{timeToBeat.normally != null ? (
							<StatBlock label="Normal" value={formatMinutes(timeToBeat.normally)} />
						) : null}
						{timeToBeat.completely != null ? (
							<StatBlock label="100%" value={formatMinutes(timeToBeat.completely)} />
						) : null}
					</Box>
				</Box>
			)}
			{platformReleases && platformReleases.length > 0 && (
				<Box>
					<SectionLabel label="Platforms" />
					{platformReleases.map((platform) => (
						<Box
							key={platform.name}
							className="mb-2 flex-row items-center justify-between rounded-xl px-4 py-3"
							style={{
								borderWidth: 1,
								borderColor: hexToRgba(ACCENT, 0.14),
								backgroundColor: hexToRgba(ACCENT, 0.07),
							}}
						>
							<Text className="text-[13px] font-sans-medium text-foreground web:text-[15px]">
								{platform.name}
							</Text>
							{platform.releaseDate ? (
								<Text className="text-[12px] font-mono text-muted-foreground web:text-[14px]">
									{dayjs(platform.releaseDate).format("MMM D, YYYY")}
								</Text>
							) : null}
						</Box>
					))}
				</Box>
			)}
		</Box>
	);
}

export function AnimeAiringSchedule(props: { entity: AnimeDetail }) {
	const schedule = props.entity.properties.airingSchedule;
	if (!schedule || schedule.length === 0) {
		return null;
	}

	return (
		<Box>
			<SectionLabel label="Airing Schedule" />
			{schedule.map((item) => (
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
	);
}
