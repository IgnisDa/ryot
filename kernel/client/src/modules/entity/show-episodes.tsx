import clsx from "clsx";
import { Pressable, ScrollView, Text, View } from "react-native";

import { AppChip } from "@/modules/ui/chip";

import {
	isSpecialsSeason,
	selectedShowSeason,
	showEpisodeAirDateLabel,
	showEpisodeAsset,
	showEpisodeNumberLabel,
	showEpisodeOriginLabel,
	showEpisodeRuntimeLabel,
	showEpisodeStateLabel,
	showEpisodeSynopsis,
	showEpisodesError,
	showNextUpEpisode,
	showSeasonEpisodesError,
	showSeasonAsset,
	showSeasonCompletedLabel,
	showSeasonCompletionPercent,
	showSeasonDescription,
	showSeasonEpisodeCountLabel,
	showSeasonLabel,
	showSeasonReleaseLabel,
	type ShowEpisode,
	type ShowEpisodesState,
	type ShowSeason,
	type ShowSeasonEpisodesState,
	type ShowSeasonList,
} from "./show-episodes-state";
import { ShowAssetImage } from "./show-image";
import { ShowProgressBar, ShowStatusMessage } from "./show-primitives";

const DESCRIPTION_CLAMP = 2;

const metaLabel = (parts: readonly (string | undefined)[]) =>
	parts.filter((part) => part !== undefined).join(" • ");

function ShowSeasonSelector(props: {
	readonly selectedId: string;
	readonly seasons: ShowSeasonList;
	readonly onSelect: (seasonId: string) => void;
}) {
	if (props.seasons.length === 1) {
		return null;
	}
	return (
		<ScrollView horizontal showsHorizontalScrollIndicator={false}>
			<View className="flex-row gap-2">
				{props.seasons.map((season) => (
					<AppChip
						role="radio"
						key={season.id}
						label={showSeasonLabel(season)}
						checked={season.id === props.selectedId}
						onPress={() => props.onSelect(season.id)}
					/>
				))}
			</View>
		</ScrollView>
	);
}

function ShowSeasonHeader(props: {
	readonly season: ShowSeason;
	readonly episodesState: ShowSeasonEpisodesState;
}) {
	const { season } = props;
	const description = showSeasonDescription(season);
	const release = showSeasonReleaseLabel(season);
	const loadedSeason =
		props.episodesState.status === "ready" ? props.episodesState.season : undefined;
	const percent =
		loadedSeason === undefined ? undefined : showSeasonCompletionPercent(loadedSeason);
	const meta = metaLabel([
		release === undefined ? undefined : `Released ${release}`,
		loadedSeason === undefined ? undefined : showSeasonEpisodeCountLabel(loadedSeason),
		loadedSeason === undefined ? undefined : showSeasonCompletedLabel(loadedSeason),
	]);
	return (
		<View className="gap-3">
			<View className="flex-row items-start gap-3 md:gap-4">
				<ShowAssetImage
					asset={showSeasonAsset(season)}
					className="aspect-2/3 w-11 shrink-0 md:w-14"
				/>
				<View className="min-w-0 flex-1 gap-1">
					<Text className="font-display-semibold text-[17px] text-text md:text-xl">
						{showSeasonLabel(season)}
					</Text>
					{meta === "" ? null : (
						<Text className="font-ui text-[12px] text-text-subtle">{meta}</Text>
					)}
				</View>
			</View>
			{percent === undefined ? null : <ShowProgressBar percent={percent} />}
			{description === undefined ? null : (
				<Text numberOfLines={DESCRIPTION_CLAMP} className="font-ui text-[13px] leading-5 text-text">
					{description}
				</Text>
			)}
		</View>
	);
}

function ShowEpisodeRow(props: { readonly divided: boolean; readonly episode: ShowEpisode }) {
	const { episode } = props;
	const synopsis = showEpisodeSynopsis(episode);
	const lifecycle = showEpisodeStateLabel(episode.state);
	const meta = metaLabel([showEpisodeAirDateLabel(episode), showEpisodeRuntimeLabel(episode)]);
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={`Open ${episode.name}`}
			onPress={() => console.log("TODO: open episode details")}
			className={clsx(
				"flex-row items-start gap-3 py-3 focus-visible:outline-2 focus-visible:outline-accent md:gap-4 md:py-4",
				props.divided && "border-t border-border",
			)}
		>
			<ShowAssetImage
				asset={showEpisodeAsset(episode)}
				className="aspect-video w-28 shrink-0 sm:w-32 md:w-44"
			/>
			<View className="min-w-0 flex-1 gap-1">
				<View className="flex-row items-baseline gap-2">
					<Text className="font-ui-medium text-[12px] text-text-subtle">
						{showEpisodeNumberLabel(episode)}
					</Text>
					<Text numberOfLines={1} className="min-w-0 flex-1 font-ui-medium text-[14px] text-text">
						{episode.name}
					</Text>
					{lifecycle === undefined ? null : (
						<Text
							className={clsx(
								"font-ui text-[12px]",
								episode.state === "complete" ? "text-success" : "text-accent-text",
							)}
						>
							{lifecycle}
						</Text>
					)}
				</View>
				{meta === "" ? null : <Text className="font-ui text-[12px] text-text-subtle">{meta}</Text>}
				{synopsis === undefined ? null : (
					<Text
						numberOfLines={DESCRIPTION_CLAMP}
						className="font-ui text-[13px] leading-5 text-text-muted"
					>
						{synopsis}
					</Text>
				)}
			</View>
		</Pressable>
	);
}

function ShowNextUp(props: { readonly episode: ShowEpisode }) {
	return (
		<View className="rounded-lg border border-border bg-surface px-3.5 pt-2.5 pb-1 md:px-4">
			<View className="flex-row items-center gap-2">
				<Text className="font-ui-medium text-[11px] tracking-widest text-text-subtle uppercase">
					Next up
				</Text>
				<Text className="font-ui text-[11px] text-text-subtle">
					{showEpisodeOriginLabel(props.episode)}
				</Text>
			</View>
			<ShowEpisodeRow divided={false} episode={props.episode} />
		</View>
	);
}

function ShowSeasonEpisodes(props: {
	readonly refresh: () => void;
	readonly state: ShowSeasonEpisodesState;
}) {
	if (props.state.status === "loading") {
		return (
			<ShowStatusMessage title="Loading season..." detail="Fetching this season's episodes." />
		);
	}
	if (props.state.status === "transport-error" || props.state.status === "malformed") {
		return <ShowStatusMessage {...showSeasonEpisodesError(props.state)} onRetry={props.refresh} />;
	}
	if (props.state.status === "empty") {
		return (
			<ShowStatusMessage title="Season unavailable" detail="This season could not be found." />
		);
	}
	const episodes = props.state.season.episodes.items;
	if (episodes.length === 0) {
		return (
			<Text className="font-ui text-[13px] text-text-muted">
				No episodes have been recorded for this season yet.
			</Text>
		);
	}
	return (
		<View>
			{episodes.map((episode, index) => (
				<ShowEpisodeRow key={episode.id} episode={episode} divided={index > 0} />
			))}
		</View>
	);
}

function ShowSeasonBrowser(props: {
	readonly seasons: ShowSeasonList;
	readonly selectedId: string | null;
	readonly onRefreshSeason: () => void;
	readonly onSelect: (seasonId: string) => void;
	readonly seasonEpisodes: ShowSeasonEpisodesState;
}) {
	const season = selectedShowSeason(props.seasons, props.selectedId);
	const nextUp =
		isSpecialsSeason(season) || props.seasonEpisodes.status !== "ready"
			? undefined
			: showNextUpEpisode(props.seasonEpisodes.season.episodes.items);
	return (
		<View className="gap-5 pt-6 md:gap-6 md:pt-8">
			<ShowSeasonSelector
				selectedId={season.id}
				seasons={props.seasons}
				onSelect={props.onSelect}
			/>
			<ShowSeasonHeader season={season} episodesState={props.seasonEpisodes} />
			{nextUp === undefined ? null : <ShowNextUp episode={nextUp} />}
			<ShowSeasonEpisodes state={props.seasonEpisodes} refresh={props.onRefreshSeason} />
		</View>
	);
}

export function ShowEpisodes(props: {
	readonly refresh: () => void;
	readonly state: ShowEpisodesState;
	readonly selectedId: string | null;
	readonly onRefreshSeason: () => void;
	readonly onSelect: (seasonId: string) => void;
	readonly seasonEpisodes: ShowSeasonEpisodesState;
}) {
	const { state } = props;
	if (state.status === "loading") {
		return (
			<ShowStatusMessage title="Loading episodes..." detail="Fetching the seasons for this show." />
		);
	}
	if (state.status === "transport-error" || state.status === "malformed") {
		return <ShowStatusMessage {...showEpisodesError(state)} onRetry={props.refresh} />;
	}
	if (state.status === "empty") {
		return (
			<ShowStatusMessage
				title="No episodes yet"
				detail="This show has no seasons or episodes recorded yet."
			/>
		);
	}
	return (
		<ShowSeasonBrowser
			seasons={state.seasons}
			onSelect={props.onSelect}
			selectedId={props.selectedId}
			seasonEpisodes={props.seasonEpisodes}
			onRefreshSeason={props.onRefreshSeason}
		/>
	);
}
