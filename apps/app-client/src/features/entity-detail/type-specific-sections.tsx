import { dayjs } from "@ryot/ts-utils";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import type React from "react";
import { useEffect, useState } from "react";
import { Image, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

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

function CollapsibleContent(props: { isOpen: boolean; children: React.ReactNode }) {
	const heightAnim = useSharedValue(0);
	const [naturalHeight, setNaturalHeight] = useState(0);

	useEffect(() => {
		heightAnim.value = withTiming(props.isOpen ? naturalHeight : 0, { duration: 250 });
	}, [props.isOpen, naturalHeight, heightAnim]);

	const animStyle = useAnimatedStyle(() => ({ overflow: "hidden", height: heightAnim.value }));

	return (
		<Animated.View style={animStyle}>
			<View
				style={{ position: "absolute", width: "100%" }}
				onLayout={(e) => {
					const h = e.nativeEvent.layout.height;
					if (h > 0) {
						setNaturalHeight(h);
					}
				}}
			>
				{props.children}
			</View>
		</Animated.View>
	);
}

export function ShowSeasonsList(props: { entity: ShowDetail }) {
	const [openId, setOpenId] = useState<number | null>(null);
	const seasons = props.entity.properties.showSeasons;

	return (
		<Box>
			{seasons.map((season) => {
				const isOpen = openId === season.id;
				const seasonPoster = season.posterImages[0] ?? null;
				return (
					<Box key={season.id} className="mb-2">
						<Pressable
							onPress={() => setOpenId(isOpen ? null : season.id)}
							className="flex-row items-center justify-between rounded-xl px-4 py-3"
							style={{
								borderWidth: 1,
								borderColor: hexToRgba(ACCENT, 0.14),
								backgroundColor: hexToRgba(ACCENT, 0.07),
							}}
						>
							<Box className="mr-3 min-w-0 flex-1">
								<Text className="text-[14px] font-sans-semibold text-foreground web:text-[16px]">
									{season.name}
								</Text>
								<Text className="mt-0.5 text-[12px] font-mono text-muted-foreground web:text-[14px]">
									{season.episodes.length} episodes
									{season.publishDate ? ` · ${dayjs(season.publishDate).format("YYYY")}` : ""}
								</Text>
							</Box>
							<Box className="flex-row items-center gap-3">
								{seasonPoster ? (
									<Box className="overflow-hidden rounded" style={{ width: 36, height: 54 }}>
										<Image
											resizeMode="cover"
											source={{ uri: seasonPoster }}
											style={{ width: 36, height: 54 }}
										/>
									</Box>
								) : null}
								{isOpen ? (
									<ChevronUp size={16} color={ACCENT} strokeWidth={2} />
								) : (
									<ChevronDown size={16} color={ACCENT} strokeWidth={2} />
								)}
							</Box>
						</Pressable>
						<CollapsibleContent isOpen={isOpen}>
							<Box
								className="mx-1 rounded-b-xl px-4 pb-2"
								style={{ backgroundColor: hexToRgba(ACCENT, 0.04) }}
							>
								{season.overview ? (
									<Text
										numberOfLines={3}
										className="mb-1 mt-3 text-[12px] font-sans leading-relaxed text-muted-foreground web:text-[14px]"
									>
										{season.overview}
									</Text>
								) : null}
								{season.episodes.map((episode) => {
									const episodePoster = episode.posterImages[0] ?? null;
									return (
										<Box
											key={episode.id}
											className="border-b py-2.5"
											style={{ borderColor: hexToRgba(ACCENT, 0.1) }}
										>
											<Box className="flex-row items-start gap-3">
												{episodePoster ? (
													<Box
														className="overflow-hidden rounded"
														style={{ width: 72, height: 41, flexShrink: 0 }}
													>
														<Image
															resizeMode="cover"
															source={{ uri: episodePoster }}
															style={{ width: 72, height: 41 }}
														/>
													</Box>
												) : null}
												<Box className="min-w-0 flex-1">
													<Box className="flex-row items-baseline">
														<Text className="mr-2 w-8 shrink-0 text-[12px] font-mono text-muted-foreground web:text-[14px]">
															{`E${String(episode.episodeNumber).padStart(2, "0")}`}
														</Text>
														<Text
															numberOfLines={1}
															className="flex-1 text-[13px] font-sans text-foreground web:text-[15px]"
														>
															{episode.name}
														</Text>
														{episode.runtime != null ? (
															<Text className="ml-2 shrink-0 text-[12px] font-mono text-muted-foreground web:text-[14px]">
																{formatMinutes(episode.runtime)}
															</Text>
														) : null}
													</Box>
												</Box>
											</Box>
											{episode.overview ? (
												<Text className="mt-2 text-[12px] font-sans leading-relaxed text-muted-foreground web:text-[13px]">
													{episode.overview}
												</Text>
											) : null}
										</Box>
									);
								})}
							</Box>
						</CollapsibleContent>
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
			{episodes.map((episode) => (
				<Box
					key={episode.id}
					className="border-b py-3"
					style={{ borderColor: hexToRgba(ACCENT, 0.12) }}
				>
					<Box className="flex-row items-start gap-3">
						{episode.thumbnail ? (
							<Box
								className="overflow-hidden rounded"
								style={{ width: 56, height: 56, flexShrink: 0 }}
							>
								<Image
									resizeMode="cover"
									style={{ width: 56, height: 56 }}
									source={{ uri: episode.thumbnail }}
								/>
							</Box>
						) : null}
						<Box className="flex-1">
							<Text
								numberOfLines={2}
								className="text-[13px] font-sans-medium text-foreground web:text-[15px]"
							>
								{episode.title}
							</Text>
							<Text
								numberOfLines={1}
								className="mt-1 text-[11px] font-mono text-muted-foreground web:text-[13px]"
							>
								{`Episode ${episode.number} · ${dayjs(episode.publishDate).format("MMM D, YYYY")}${episode.runtime != null ? ` · ${formatMinutes(episode.runtime)}` : ""}`}
							</Text>
						</Box>
					</Box>
					{episode.overview ? (
						<Text className="mt-2 text-[12px] font-sans leading-relaxed text-muted-foreground web:text-[13px]">
							{episode.overview}
						</Text>
					) : null}
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
