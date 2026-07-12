import { createRyotQuery, ManagedAssetProvider, useRyotQuery } from "@ryot-app/client-sdk/react";
import { Chip } from "@ryot-app/client-ui-sdk";
import { fieldSyncState, isTitleProvisional, SyncPip } from "@ryot-app/client-ui-sdk/sync";
import clsx from "clsx";
import { useState } from "react";

import { showSeasonEpisodesRecipe, showSeasonsRecipe } from "../../shared/show-recipes";
import {
	MediaEpisodePages,
	type MediaEpisodePageInput,
	type MediaEpisodePagesCopy,
	type MediaEpisodeRender,
} from "../media/episodes";
import {
	mediaEpisodeNumberLabel,
	mediaEpisodePageError,
	type MediaEpisodePage,
} from "../media/episodes-state";
import { ManagedAssetImage } from "../media/managed-assets";
import { MediaProgressBar, MediaRefreshStatus, MediaStatusMessage } from "../media/primitives";
import {
	isSpecialsSeason,
	mapShowSeasons,
	selectedShowSeason,
	showEpisodeOriginLabel,
	showSeasonAsset,
	showSeasonCompletedLabel,
	showSeasonCompletionPercent,
	showSeasonDescription,
	showSeasonEpisodeCountLabel,
	showSeasonLabel,
	showSeasonReleaseLabel,
	showSeasonsError,
	showSeasonsManagedAssets,
	type ShowEpisode,
	type ShowSeason,
	type ShowSeasonList,
	type ShowSeasonsResult,
	type ShowSeasonsState,
} from "./episodes-state";

export const SHOW_SEASON_LIMIT = 40;

export const SHOW_EPISODE_PAGE_LIMIT = 60;

export const showSeasonsQuery = createRyotQuery<{ readonly entityId: string }, ShowSeasonsResult>(
	({ input, client, signal }) =>
		client.data.query(
			showSeasonsRecipe({ entityId: input.entityId, seasonLimit: SHOW_SEASON_LIMIT }),
			{ signal },
		),
	{
		entityInterest: ({ data, input }) => ({
			foreground: [input.entityId],
			visible: data?.seasons.items.map(({ id }) => id) ?? [],
		}),
	},
);

export const showSeasonEpisodesQuery = createRyotQuery<
	MediaEpisodePageInput,
	MediaEpisodePage<ShowEpisode>
>(
	({ input, client, signal }) =>
		client.data.query(
			showSeasonEpisodesRecipe({
				limit: SHOW_EPISODE_PAGE_LIMIT,
				containerId: input.containerId,
				...(input.after === null ? {} : { after: input.after }),
			}),
			{ signal },
		),
	{
		entityInterest: ({ data, input }) => ({
			visible: data?.items.map(({ id }) => id) ?? [],
			foreground: [input.entityId, input.containerId],
		}),
	},
);

const SHOW_EPISODE_RENDER: MediaEpisodeRender<ShowEpisode> = {
	aspect: "video",
	purpose: "still",
	originLabel: showEpisodeOriginLabel,
	numberLabel: mediaEpisodeNumberLabel,
	stateLabels: { complete: "Watched", untracked: undefined, in_progress: "In progress" },
};

const SHOW_EPISODE_PAGES_COPY: MediaEpisodePagesCopy = {
	empty: "No episodes have been recorded for this season yet.",
	loading: { title: "Loading season...", detail: "Fetching this season's episodes." },
	error: (state) => ({
		...mediaEpisodePageError({ state, noun: "episodes" }),
		title: "Unable to load this season",
	}),
};

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
			<div role="radiogroup" className="flex w-max gap-2">
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

function ShowSeasonHeader(props: { readonly compact: boolean; readonly season: ShowSeason }) {
	const { season } = props;
	const release = showSeasonReleaseLabel(season);
	const percent = showSeasonCompletionPercent(season);
	const description = showSeasonDescription(season);
	const meta = metaLabel([
		release === undefined ? undefined : `Released ${release}`,
		showSeasonEpisodeCountLabel(season),
		showSeasonCompletedLabel(season),
	]);
	return (
		<div className="flex flex-col gap-3">
			<div className={clsx("flex items-start", props.compact ? "gap-3" : "gap-4")}>
				<ManagedAssetImage
					monogram={season.name}
					asset={showSeasonAsset(season)}
					state={fieldSyncState(showSeasonAsset(season), season)}
					className={clsx("aspect-2/3 shrink-0", props.compact ? "w-11" : "w-14")}
				/>
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<p
						className={clsx(
							"font-display font-semibold text-text",
							props.compact ? "text-[17px]" : "text-xl",
						)}
					>
						{showSeasonLabel(season)}
						{isTitleProvisional(season) && <SyncPip className="ml-1.5" reason="translating" />}
					</p>
					{meta === "" ? null : <p className="font-ui text-[12px] text-text-subtle">{meta}</p>}
				</div>
			</div>
			{percent === undefined ? null : <MediaProgressBar percent={percent} />}
			{description === undefined ? null : (
				<p className="line-clamp-2 font-ui text-[13px] leading-5 text-text">{description}</p>
			)}
		</div>
	);
}

function ShowSeasonBrowser(props: {
	readonly compact: boolean;
	readonly entityId: string;
	readonly seasons: ShowSeasonList;
	readonly selectedId: string | null;
	readonly onSelect: (seasonId: string) => void;
}) {
	const season = selectedShowSeason(props.seasons, props.selectedId);
	return (
		<ManagedAssetProvider assets={showSeasonsManagedAssets(props.seasons)}>
			<div className={clsx("flex flex-col", props.compact ? "gap-5 pt-6" : "gap-6 pt-8")}>
				<ShowSeasonSelector
					selectedId={season.id}
					seasons={props.seasons}
					onSelect={props.onSelect}
				/>
				<ShowSeasonHeader season={season} compact={props.compact} />
				<MediaEpisodePages
					containerId={season.id}
					compact={props.compact}
					entityId={props.entityId}
					render={SHOW_EPISODE_RENDER}
					copy={SHOW_EPISODE_PAGES_COPY}
					query={showSeasonEpisodesQuery}
					nextUp={isSpecialsSeason(season) ? undefined : "forward"}
				/>
			</div>
		</ManagedAssetProvider>
	);
}

export function ShowEpisodes(props: {
	readonly compact: boolean;
	readonly entityId: string;
	readonly refresh: () => void;
	readonly state: ShowSeasonsState;
	readonly selectedId: string | null;
	readonly onSelect: (seasonId: string) => void;
}) {
	const { state } = props;
	if (state.status === "loading") {
		return (
			<MediaStatusMessage
				title="Loading episodes..."
				detail="Fetching the seasons for this show."
			/>
		);
	}
	if (state.status === "transport-error" || state.status === "malformed") {
		return <MediaStatusMessage {...showSeasonsError(state)} onRetry={props.refresh} />;
	}
	if (state.status === "empty") {
		return (
			<MediaStatusMessage
				title="No episodes yet"
				detail="This show has no seasons or episodes recorded yet."
			/>
		);
	}
	return (
		<ShowSeasonBrowser
			seasons={state.seasons}
			compact={props.compact}
			entityId={props.entityId}
			onSelect={props.onSelect}
			selectedId={props.selectedId}
		/>
	);
}

export function ShowEpisodesTab(props: { readonly compact: boolean; readonly entityId: string }) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const result = useRyotQuery(showSeasonsQuery, { entityId: props.entityId });
	return (
		<>
			<MediaRefreshStatus result={result} />
			<ShowEpisodes
				selectedId={selectedId}
				compact={props.compact}
				onSelect={setSelectedId}
				refresh={result.refetch}
				entityId={props.entityId}
				state={mapShowSeasons(result)}
			/>
		</>
	);
}
