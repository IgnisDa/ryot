import { Schema } from "@ryot-app/client-sdk/effect";
import {
	createRyotQuery,
	ManagedAssetProvider,
	usePluginStorage,
	useRyotQuery,
	type PluginStorageState,
} from "@ryot-app/client-sdk/react";
import { Chip } from "@ryot-app/client-ui-sdk";
import { fieldSyncState, isTitleProvisional, SyncPip } from "@ryot-app/client-ui-sdk/sync";
import clsx from "clsx";
import { useEffect, useState } from "react";

import { mediaPluginSlug } from "../../shared/media-schema-slugs";
import type { ShowEpisodeOrder } from "../../shared/show-episode-order";
import {
	showOrderEpisodesRecipe,
	showOrderGroupCoverageRecipe,
	showSeasonEpisodesRecipe,
	showSeasonsRecipe,
} from "../../shared/show-recipes";
import { mediaCursorPageError, type MediaCursorPage } from "../media/cursor-page-state";
import {
	MediaEpisodePages,
	type MediaEpisodePageInput,
	type MediaEpisodePagesCopy,
	type MediaEpisodeRender,
} from "../media/episodes";
import { mediaEpisodeNumberLabel } from "../media/episodes-state";
import { ManagedAssetImage } from "../media/managed-assets";
import { MediaProgressBar, MediaRefreshStatus, MediaStatusMessage } from "../media/primitives";
import {
	orderByExternalIds,
	resolveShowEpisodeOrder,
	showEpisodeOrderStorageKey,
	showOrderEpisodePage,
} from "./episode-order-state";
import {
	mapShowSeasons,
	selectedShowSeason,
	showCoverageAiredLabel,
	showCoverageCompletionPercent,
	showEpisodeOriginLabel,
	showSeasonAsset,
	showSeasonDescription,
	showSeasonLabel,
	showSeasonReleaseLabel,
	showSeasonsError,
	showSeasonsManagedAssets,
	type ShowEpisode,
	type ShowOrderEpisode,
	type ShowOrderGroupCoverage,
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
	MediaCursorPage<ShowEpisode>
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

type ShowOrderEpisodePageInput = MediaEpisodePageInput<{
	readonly episodeExternalIds: readonly string[];
}>;

/** One page of an order group: the next slice of its episode ids, in the group's order. */
export const showOrderEpisodesQuery = createRyotQuery<
	ShowOrderEpisodePageInput,
	MediaCursorPage<ShowOrderEpisode>
>(
	async ({ input, client, signal }) => {
		const page = showOrderEpisodePage(
			input.episodeExternalIds,
			input.after,
			SHOW_EPISODE_PAGE_LIMIT,
		);
		if (page === null) {
			return { items: [], pageInfo: { nextCursor: null } };
		}
		const rows = await client.data.query(
			showOrderEpisodesRecipe({ entityId: input.entityId, externalIds: page.externalIds }),
			{ signal },
		);
		return {
			pageInfo: { nextCursor: page.nextCursor },
			items: orderByExternalIds(rows, page.externalIds),
		};
	},
	{
		entityInterest: ({ data, input }) => ({
			foreground: [input.entityId],
			visible: data?.items.map(({ id }) => id) ?? [],
		}),
	},
);

const showOrderGroupCoverageQuery = createRyotQuery<
	{ readonly entityId: string; readonly externalIds: readonly string[] },
	ShowOrderGroupCoverage
>(
	({ input, client, signal }) => {
		const [first, ...rest] = input.externalIds;
		return first === undefined
			? Promise.resolve(null)
			: client.data.query(
					showOrderGroupCoverageRecipe({ entityId: input.entityId, externalIds: [first, ...rest] }),
					{ signal },
				);
	},
	{ entityInterest: ({ input }) => ({ visible: [], foreground: [input.entityId] }) },
);

const SHOW_EPISODE_RENDER: MediaEpisodeRender<ShowEpisode> = {
	aspect: "still",
	purpose: "still",
	originLabel: showEpisodeOriginLabel,
	numberLabel: mediaEpisodeNumberLabel,
	stateLabels: { complete: "Watched", untracked: undefined, in_progress: "In progress" },
};

const SHOW_ORDER_EPISODE_RENDER: MediaEpisodeRender<ShowOrderEpisode> = {
	...SHOW_EPISODE_RENDER,
	numberLabel: showEpisodeOriginLabel,
};

const SHOW_EPISODE_PAGES_COPY: MediaEpisodePagesCopy = {
	empty: "No episodes have been recorded for this season yet.",
	loading: { title: "Loading season...", detail: "Fetching this season's episodes." },
	error: (state) => ({
		...mediaCursorPageError({ state, noun: "episodes" }),
		title: "Unable to load this season",
	}),
};

const SHOW_ORDER_EPISODE_PAGES_COPY: MediaEpisodePagesCopy = {
	empty: "No episodes have been recorded for this group yet.",
	error: (state) => mediaCursorPageError({ state, noun: "episodes" }),
	loading: { title: "Loading episodes...", detail: "Fetching this group's episodes." },
};

const metaLabel = (parts: readonly (string | undefined)[]) =>
	parts.filter((part) => part !== undefined).join(" • ");

type ShowChipOption = {
	readonly key: string;
	readonly label: string;
	readonly checked: boolean;
	readonly select: () => void;
};

function ShowChipSelector(props: {
	readonly label: string;
	readonly options: readonly ShowChipOption[];
}) {
	return (
		<div className="overflow-x-auto">
			<div role="radiogroup" aria-label={props.label} className="flex w-max gap-2">
				{props.options.map((option) => (
					<button
						role="radio"
						type="button"
						key={option.key}
						onClick={option.select}
						aria-checked={option.checked}
					>
						<Chip label={option.label} checked={option.checked} />
					</button>
				))}
			</div>
		</div>
	);
}

function ShowEpisodeOrderSelector(props: {
	readonly selected: ShowEpisodeOrder | null;
	readonly orders: readonly ShowEpisodeOrder[];
	readonly onSelect: (orderId: string | null) => void;
}) {
	if (props.orders.length === 0) {
		return null;
	}
	return (
		<ShowChipSelector
			label="Episode order"
			options={[
				{
					key: "aired",
					label: "Aired order",
					checked: props.selected === null,
					select: () => props.onSelect(null),
				},
				...props.orders.map((order) => ({
					label: order.name,
					key: `order:${order.externalId}`,
					select: () => props.onSelect(order.externalId),
					checked: order.externalId === props.selected?.externalId,
				})),
			]}
		/>
	);
}

function ShowSeasonHeader(props: { readonly compact: boolean; readonly season: ShowSeason }) {
	const { season } = props;
	const release = showSeasonReleaseLabel(season);
	const percent = showCoverageCompletionPercent(season);
	const description = showSeasonDescription(season);
	const meta = metaLabel([
		release === undefined ? undefined : `Released ${release}`,
		showCoverageAiredLabel(season),
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
	readonly nextUp: ShowEpisode | null;
	readonly selectedId: string | null;
	readonly onSelect: (seasonId: string) => void;
}) {
	const { nextUp } = props;
	const season = selectedShowSeason(props.seasons, props.selectedId);
	return (
		<ManagedAssetProvider assets={showSeasonsManagedAssets(props.seasons)}>
			{props.seasons.length === 1 ? null : (
				<ShowChipSelector
					label="Season"
					options={props.seasons.map((option) => ({
						key: option.id,
						label: showSeasonLabel(option),
						checked: option.id === season.id,
						select: () => props.onSelect(option.id),
					}))}
				/>
			)}
			<ShowSeasonHeader season={season} compact={props.compact} />
			<MediaEpisodePages
				containerId={season.id}
				compact={props.compact}
				entityId={props.entityId}
				render={SHOW_EPISODE_RENDER}
				copy={SHOW_EPISODE_PAGES_COPY}
				query={showSeasonEpisodesQuery}
				nextUp={nextUp?.seasonNumber === season.seasonNumber ? nextUp : null}
			/>
		</ManagedAssetProvider>
	);
}

function ShowOrderGroupHeader(props: {
	readonly compact: boolean;
	readonly entityId: string;
	readonly group: ShowEpisodeOrder["groups"][number];
}) {
	const result = useRyotQuery(showOrderGroupCoverageQuery, {
		entityId: props.entityId,
		externalIds: props.group.episodeExternalIds,
	});
	const coverage = result.data ?? null;
	const percent = coverage === null ? undefined : showCoverageCompletionPercent(coverage);
	const meta = coverage === null ? undefined : showCoverageAiredLabel(coverage);
	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-1">
				<p
					className={clsx(
						"font-display font-semibold text-text",
						props.compact ? "text-[17px]" : "text-xl",
					)}
				>
					{props.group.name}
				</p>
				{meta === undefined ? null : <p className="font-ui text-[12px] text-text-subtle">{meta}</p>}
			</div>
			{percent === undefined ? null : <MediaProgressBar percent={percent} />}
		</div>
	);
}

/** An episode order's groups in place of seasons; it starts on the first group. */
function ShowOrderBrowser(props: {
	readonly compact: boolean;
	readonly entityId: string;
	readonly order: ShowEpisodeOrder;
}) {
	const { order } = props;
	const [selectedIndex, setSelectedIndex] = useState(0);
	const index = selectedIndex < order.groups.length ? selectedIndex : 0;
	const group = order.groups[index];
	if (group === undefined) {
		return (
			<MediaStatusMessage
				title="No episodes yet"
				detail="This episode order has no groups recorded yet."
			/>
		);
	}
	return (
		<>
			{order.groups.length === 1 ? null : (
				<ShowChipSelector
					label="Episode group"
					options={order.groups.map((option, optionIndex) => ({
						label: option.name,
						key: String(optionIndex),
						checked: optionIndex === index,
						select: () => setSelectedIndex(optionIndex),
					}))}
				/>
			)}
			<ShowOrderGroupHeader group={group} compact={props.compact} entityId={props.entityId} />
			<MediaEpisodePages
				nextUp={null}
				compact={props.compact}
				entityId={props.entityId}
				query={showOrderEpisodesQuery}
				render={SHOW_ORDER_EPISODE_RENDER}
				copy={SHOW_ORDER_EPISODE_PAGES_COPY}
				containerId={`${order.externalId}:${index}`}
				scope={{ episodeExternalIds: group.episodeExternalIds }}
			/>
		</>
	);
}

export function ShowEpisodes(props: {
	readonly compact: boolean;
	readonly entityId: string;
	readonly refresh: () => void;
	readonly state: ShowSeasonsState;
	readonly nextUp: ShowEpisode | null;
	readonly selectedId: string | null;
	readonly onSelect: (seasonId: string) => void;
	readonly order: ShowEpisodeOrder | null;
	readonly onSelectOrder: (orderId: string | null) => void;
}) {
	const { state, order } = props;
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
		<div className={clsx("flex flex-col", props.compact ? "gap-5 pt-6" : "gap-6 pt-8")}>
			<ShowEpisodeOrderSelector
				selected={order}
				orders={state.episodeOrders}
				onSelect={props.onSelectOrder}
			/>
			{order === null ? (
				<ShowSeasonBrowser
					nextUp={props.nextUp}
					seasons={state.seasons}
					compact={props.compact}
					entityId={props.entityId}
					onSelect={props.onSelect}
					selectedId={props.selectedId}
				/>
			) : (
				<ShowOrderBrowser
					order={order}
					key={order.externalId}
					compact={props.compact}
					entityId={props.entityId}
				/>
			)}
		</div>
	);
}

const persistOrder = (write: Promise<void>) => void write.catch(() => undefined);

function ShowEpisodesWithOrder(props: {
	readonly compact: boolean;
	readonly entityId: string;
	readonly nextUp: ShowEpisode | null;
	readonly storage: Extract<PluginStorageState<string>, { readonly status: "ready" }>;
}) {
	const { storage } = props;
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const result = useRyotQuery(showSeasonsQuery, { entityId: props.entityId });
	const state = mapShowSeasons(result);
	const resolved =
		state.status === "ready" ? resolveShowEpisodeOrder(state.episodeOrders, storage.value) : null;
	const stale = resolved?.stale === true;
	const { remove } = storage;
	useEffect(() => {
		if (stale) {
			persistOrder(remove());
		}
	}, [stale, remove]);
	return (
		<>
			<MediaRefreshStatus result={result} />
			<ShowEpisodes
				state={state}
				nextUp={props.nextUp}
				selectedId={selectedId}
				compact={props.compact}
				onSelect={setSelectedId}
				refresh={result.refetch}
				entityId={props.entityId}
				order={resolved?.order ?? null}
				onSelectOrder={(orderId) =>
					persistOrder(orderId === null ? remove() : storage.set(orderId))
				}
			/>
		</>
	);
}

/** Resolves the device's stored episode order before the seasons query runs. */
export function ShowEpisodesTab(props: {
	readonly compact: boolean;
	readonly entityId: string;
	readonly summary: { readonly nextUp: ShowEpisode | null } | undefined;
}) {
	const storage = usePluginStorage({
		schema: Schema.String,
		pluginSlug: mediaPluginSlug,
		key: showEpisodeOrderStorageKey(props.entityId),
	});
	if (storage.status === "loading") {
		return (
			<MediaStatusMessage title="Loading episodes..." detail="Restoring your episode order." />
		);
	}
	return (
		<ShowEpisodesWithOrder
			storage={storage}
			compact={props.compact}
			entityId={props.entityId}
			nextUp={props.summary?.nextUp ?? null}
		/>
	);
}
