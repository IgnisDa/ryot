import { useRyotQuery } from "@ryot-app/client-sdk/react";
import { Chip } from "@ryot-app/client-ui-sdk";
import clsx from "clsx";
import { useState, type ReactNode } from "react";

import {
	isSpecialsSeason,
	mapShowEpisodes,
	mapShowSeasonEpisodes,
	selectedShowSeason,
	showEpisodeAirDateLabel,
	showEpisodeAsset,
	showEpisodeNumberLabel,
	showEpisodeOriginLabel,
	showEpisodeRuntimeLabel,
	showEpisodeStateLabel,
	showEpisodeSynopsis,
	showEpisodesError,
	showEpisodesManagedAssets,
	showNextUpEpisode,
	showSeasonAsset,
	showSeasonCompletedLabel,
	showSeasonCompletionPercent,
	showSeasonDescription,
	showSeasonEpisodeCountLabel,
	showSeasonEpisodesError,
	showSeasonLabel,
	showSeasonReleaseLabel,
	type ShowEpisode,
	type ShowEpisodesState,
	type ShowSeason,
	type ShowSeasonEpisodesState,
	type ShowSeasonList,
} from "./episodes-state";
import { ManagedAssetImage, ManagedAssetProvider } from "./managed-assets";
import { ShowProgressBar, ShowStatusMessage } from "./primitives";
import { showEpisodesQuery, showSeasonEpisodesQuery } from "./queries";

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
		<div className="overflow-x-auto">
			<div role="radiogroup" className="flex gap-2">
				{props.seasons.map((season) => {
					const isSelected = season.id === props.selectedId;
					return (
						<button
							role="radio"
							type="button"
							key={season.id}
							aria-checked={isSelected}
							onClick={() => props.onSelect(season.id)}
						>
							<Chip checked={isSelected} label={showSeasonLabel(season)} />
						</button>
					);
				})}
			</div>
		</div>
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
		<div className="flex flex-col gap-3">
			<div className="flex items-start gap-3 md:gap-4">
				<ManagedAssetImage
					asset={showSeasonAsset(season)}
					className="aspect-2/3 w-11 shrink-0 md:w-14"
				/>
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<p className="font-display font-semibold text-[17px] text-text md:text-xl">
						{showSeasonLabel(season)}
					</p>
					{meta === "" ? null : <p className="font-ui text-[12px] text-text-subtle">{meta}</p>}
				</div>
			</div>
			{percent === undefined ? null : <ShowProgressBar percent={percent} />}
			{description === undefined ? null : (
				<p className="line-clamp-2 font-ui text-[13px] leading-5 text-text">{description}</p>
			)}
		</div>
	);
}

function ShowEpisodeRow(props: { readonly divided: boolean; readonly episode: ShowEpisode }) {
	const { episode } = props;
	const synopsis = showEpisodeSynopsis(episode);
	const lifecycle = showEpisodeStateLabel(episode.state);
	const meta = metaLabel([showEpisodeAirDateLabel(episode), showEpisodeRuntimeLabel(episode)]);
	return (
		<button
			type="button"
			aria-label={`Open ${episode.name}`}
			onClick={() => console.log("TODO: open episode details")}
			className={clsx(
				"flex w-full items-start gap-3 py-3 text-left focus-visible:outline-2 focus-visible:outline-accent md:gap-4 md:py-4",
				props.divided && "border-t border-border",
			)}
		>
			<ManagedAssetImage
				asset={showEpisodeAsset(episode)}
				className="aspect-video w-28 shrink-0 sm:w-32 md:w-44"
			/>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="flex items-baseline gap-2">
					<span className="font-ui font-medium text-[12px] text-text-subtle">
						{showEpisodeNumberLabel(episode)}
					</span>
					<span className="line-clamp-1 min-w-0 flex-1 font-ui font-medium text-[14px] text-text">
						{episode.name}
					</span>
					{lifecycle === undefined ? null : (
						<span
							className={clsx(
								"font-ui text-[12px]",
								episode.state === "complete" ? "text-success" : "text-accent-text",
							)}
						>
							{lifecycle}
						</span>
					)}
				</div>
				{meta === "" ? null : <span className="font-ui text-[12px] text-text-subtle">{meta}</span>}
				{synopsis === undefined ? null : (
					<span className="line-clamp-2 font-ui text-[13px] leading-5 text-text-muted">
						{synopsis}
					</span>
				)}
			</div>
		</button>
	);
}

function ShowNextUp(props: { readonly episode: ShowEpisode }) {
	return (
		<div className="rounded-lg border border-border bg-surface px-3.5 pt-2.5 pb-1 md:px-4">
			<div className="flex items-center gap-2">
				<p className="font-ui font-medium text-[11px] tracking-widest text-text-subtle uppercase">
					Next up
				</p>
				<p className="font-ui text-[11px] text-text-subtle">
					{showEpisodeOriginLabel(props.episode)}
				</p>
			</div>
			<ShowEpisodeRow divided={false} episode={props.episode} />
		</div>
	);
}

function ShowSeasonEpisodesList(props: {
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
			<p className="font-ui text-[13px] text-text-muted">
				No episodes have been recorded for this season yet.
			</p>
		);
	}
	return (
		<div>
			{episodes.map((episode, index) => (
				<ShowEpisodeRow key={episode.id} episode={episode} divided={index > 0} />
			))}
		</div>
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
		<div className="flex flex-col gap-5 pt-6 md:gap-6 md:pt-8">
			<ShowSeasonSelector
				selectedId={season.id}
				seasons={props.seasons}
				onSelect={props.onSelect}
			/>
			<ShowSeasonHeader season={season} episodesState={props.seasonEpisodes} />
			{nextUp === undefined ? null : <ShowNextUp episode={nextUp} />}
			<ShowSeasonEpisodesList state={props.seasonEpisodes} refresh={props.onRefreshSeason} />
		</div>
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

function ShowSeasonEpisodesLoader(props: {
	readonly seasonId: string;
	readonly children: (state: ShowSeasonEpisodesState, refresh: () => void) => ReactNode;
}) {
	const result = useRyotQuery(showSeasonEpisodesQuery, { seasonId: props.seasonId });
	return props.children(mapShowSeasonEpisodes(result), result.refetch);
}

export function ShowEpisodesTab(props: { readonly entityId: string }) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const result = useRyotQuery(showEpisodesQuery, { entityId: props.entityId });
	const state = mapShowEpisodes(result);
	const seasonId =
		state.status === "ready" ? selectedShowSeason(state.seasons, selectedId).id : null;

	const body = (seasonEpisodes: ShowSeasonEpisodesState, refreshSeason: () => void) => (
		<ManagedAssetProvider
			assets={
				state.status === "ready" ? showEpisodesManagedAssets(state.seasons, seasonEpisodes) : []
			}
		>
			<ShowEpisodes
				state={state}
				selectedId={selectedId}
				refresh={result.refetch}
				onSelect={setSelectedId}
				seasonEpisodes={seasonEpisodes}
				onRefreshSeason={refreshSeason}
			/>
		</ManagedAssetProvider>
	);

	if (seasonId === null) {
		return body({ status: "loading" }, () => undefined);
	}
	return <ShowSeasonEpisodesLoader seasonId={seasonId}>{body}</ShowSeasonEpisodesLoader>;
}
