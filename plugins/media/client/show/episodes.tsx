import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import {
	createRyotQuery,
	ManagedAssetProvider,
	type PluginStorageState,
	usePluginIdentity,
	usePluginStorage,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { ChipRadioGroup, Select } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { markdownPlainText } from "@ryot-app/plugin-ui-sdk/markdown";
import { fieldSyncState, isTitleProvisional, SyncPip } from "@ryot-app/plugin-ui-sdk/sync";
import clsx from "clsx";
import { useEffect, useState } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import type { ShowEpisodeOrder } from "../../shared/show-episode-order";
import {
	showOrderEpisodesRecipe,
	showOrderGroupCoverageRecipe,
	showSeasonEpisodesRecipe,
	showSeasonsRecipe,
} from "../../shared/show-recipes";
import type { MediaActivityLogger } from "../media/activity-log/state";
import { type MediaCursorPage, mediaCursorPageError } from "../media/cursor-page-state";
import {
	type MediaEpisodePageInput,
	MediaEpisodePages,
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
	type ShowEpisode,
	showEpisodeOriginLabel,
	type ShowOrderEpisode,
	type ShowOrderGroupCoverage,
	type ShowSeason,
	showSeasonAsset,
	showSeasonDescription,
	showSeasonLabel,
	type ShowSeasonList,
	showSeasonReleaseLabel,
	showSeasonsError,
	showSeasonsManagedAssets,
	type ShowSeasonsResult,
	type ShowSeasonsState,
} from "./episodes-state";

export const SHOW_SEASON_LIMIT = 40;

export const SHOW_EPISODE_PAGE_LIMIT = 60;

export const showSeasonsQuery = createRyotQuery<{ readonly entityId: string }, ShowSeasonsResult>(
	({ input, client }) =>
		client.data.query(
			showSeasonsRecipe({
				entityId: input.entityId,
				seasonLimit: SHOW_SEASON_LIMIT,
				reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
			}),
		),
	{
		entityWatch: ({ data, input }) => ({
			foreground: [input.entityId],
			visible: data?.seasons.items.map(({ id }) => id) ?? [],
		}),
	},
);

export const showSeasonEpisodesQuery = createRyotQuery<
	MediaEpisodePageInput,
	MediaCursorPage<ShowEpisode>
>(
	({ input, client }) =>
		client.data.query(
			showSeasonEpisodesRecipe({
				limit: SHOW_EPISODE_PAGE_LIMIT,
				containerId: input.containerId,
				reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
				...(input.after === null ? {} : { after: input.after }),
			}),
		),
	{
		entityWatch: ({ data, input }) => ({
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
	({ input, client }) => {
		const page = showOrderEpisodePage(
			input.episodeExternalIds,
			input.after,
			SHOW_EPISODE_PAGE_LIMIT,
		);
		if (page === null) {
			return Effect.succeed({ items: [], pageInfo: { nextCursor: null } });
		}
		return Effect.map(
			client.data.query(
				showOrderEpisodesRecipe({
					entityId: input.entityId,
					externalIds: page.externalIds,
					reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
				}),
			),
			(rows) => ({
				pageInfo: { nextCursor: page.nextCursor },
				items: orderByExternalIds(rows, page.externalIds),
			}),
		);
	},
	{
		entityWatch: ({ data, input }) => ({
			foreground: [input.entityId],
			visible: data?.items.map(({ id }) => id) ?? [],
		}),
	},
);

const showOrderGroupCoverageQuery = createRyotQuery<
	{ readonly entityId: string; readonly externalIds: readonly string[] },
	ShowOrderGroupCoverage
>(
	({ input, client }) => {
		const [first, ...rest] = input.externalIds;
		return first === undefined
			? Effect.succeed(null)
			: client.data.query(
					showOrderGroupCoverageRecipe({
						entityId: input.entityId,
						externalIds: [first, ...rest],
						reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
					}),
				);
	},
	{ entityWatch: ({ input }) => ({ visible: [], foreground: [input.entityId] }) },
);

const showActivityEpisode = (episode: ShowEpisode | ShowOrderEpisode) => ({
	id: episode.id,
	name: episode.name,
	state: episode.state,
	seasonNumber: episode.seasonNumber,
	episodeNumber: episode.episodeNumber,
});

const SHOW_EPISODE_RENDER: MediaEpisodeRender<ShowEpisode> = {
	aspect: "still",
	purpose: "still",
	originLabel: showEpisodeOriginLabel,
	activityEpisode: showActivityEpisode,
	numberLabel: mediaEpisodeNumberLabel,
	stateLabels: { complete: "Watched", untracked: undefined, in_progress: "In progress" },
};

const SHOW_ORDER_EPISODE_RENDER: MediaEpisodeRender<ShowOrderEpisode> = {
	...SHOW_EPISODE_RENDER,
	numberLabel: showEpisodeOriginLabel,
	activityEpisode: showActivityEpisode,
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

function ShowEpisodeOrderSelector(props: {
	readonly selected: ShowEpisodeOrder | null;
	readonly orders: readonly ShowEpisodeOrder[];
	readonly onSelect: (orderId: string | null) => void;
}) {
	if (props.orders.length === 0) {
		return null;
	}
	return (
		<Select
			label="Episode order"
			className="w-full max-w-64 self-end"
			value={props.selected?.externalId ?? ""}
			checkIcon={<AppIcon size={15} name="check" />}
			chevronIcon={<AppIcon size={15} name="chevron-down" />}
			onChange={(value) => props.onSelect(value === "" ? null : value)}
			choices={[
				{ value: "", label: "Aired order" },
				...props.orders.map((order) => ({ label: order.name, value: order.externalId })),
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
				<p className="line-clamp-2 font-ui text-[13px] leading-5 text-text">
					{markdownPlainText(description)}
				</p>
			)}
		</div>
	);
}

function ShowSeasonBrowser(props: {
	readonly compact: boolean;
	readonly logger: MediaActivityLogger;
	readonly entityId: string;
	readonly safeAreaTop: number;
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
				<ChipRadioGroup
					label="Season"
					value={season.id}
					overflow="scroll"
					onChange={props.onSelect}
					options={props.seasons.map((option) => ({
						value: option.id,
						label: showSeasonLabel(option),
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
				safeAreaTop={props.safeAreaTop}
				query={showSeasonEpisodesQuery}
				log={{ logger: props.logger, parentEntityId: props.entityId }}
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
	readonly logger: MediaActivityLogger;
	readonly entityId: string;
	readonly safeAreaTop: number;
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
				<ChipRadioGroup
					overflow="scroll"
					label="Episode group"
					value={String(index)}
					onChange={(value) => setSelectedIndex(Number(value))}
					options={order.groups.map((option, optionIndex) => ({
						label: option.name,
						value: String(optionIndex),
					}))}
				/>
			)}
			<ShowOrderGroupHeader group={group} compact={props.compact} entityId={props.entityId} />
			<MediaEpisodePages
				nextUp={null}
				compact={props.compact}
				entityId={props.entityId}
				query={showOrderEpisodesQuery}
				safeAreaTop={props.safeAreaTop}
				render={SHOW_ORDER_EPISODE_RENDER}
				copy={SHOW_ORDER_EPISODE_PAGES_COPY}
				containerId={`${order.externalId}:${index}`}
				scope={{ episodeExternalIds: group.episodeExternalIds }}
				log={{ logger: props.logger, parentEntityId: props.entityId }}
			/>
		</>
	);
}

export function ShowEpisodes(props: {
	readonly compact: boolean;
	readonly logger: MediaActivityLogger;
	readonly entityId: string;
	readonly safeAreaTop: number;
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
					logger={props.logger}
					nextUp={props.nextUp}
					seasons={state.seasons}
					compact={props.compact}
					entityId={props.entityId}
					onSelect={props.onSelect}
					selectedId={props.selectedId}
					safeAreaTop={props.safeAreaTop}
				/>
			) : (
				<ShowOrderBrowser
					order={order}
					logger={props.logger}
					key={order.externalId}
					compact={props.compact}
					entityId={props.entityId}
					safeAreaTop={props.safeAreaTop}
				/>
			)}
		</div>
	);
}

const persistOrder = (write: Promise<void>) => {
	Effect.runFork(Effect.ignore(Effect.tryPromise(() => write)));
};

function ShowEpisodesWithOrder(props: {
	readonly compact: boolean;
	readonly logger: MediaActivityLogger;
	readonly entityId: string;
	readonly safeAreaTop: number;
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
				logger={props.logger}
				nextUp={props.nextUp}
				selectedId={selectedId}
				compact={props.compact}
				onSelect={setSelectedId}
				refresh={result.refetch}
				entityId={props.entityId}
				safeAreaTop={props.safeAreaTop}
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
	readonly logger: MediaActivityLogger;
	readonly entityId: string;
	readonly safeAreaTop: number;
	readonly summary: { readonly nextUp: ShowEpisode | null } | undefined;
}) {
	const identity = usePluginIdentity(PLUGIN_PACKAGE_ID);
	const storage = usePluginStorage({
		schema: Schema.String,
		pluginId: identity.pluginId,
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
			logger={props.logger}
			compact={props.compact}
			entityId={props.entityId}
			safeAreaTop={props.safeAreaTop}
			nextUp={props.summary?.nextUp ?? null}
		/>
	);
}
