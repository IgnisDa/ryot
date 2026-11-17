import type {
	EntitySettleReason,
	LocalMessage,
	ManagedAssetLocator,
} from "@ryot-app/plugin-client-sdk";
import {
	type EntityRendererProps,
	usePluginLocation,
	useRyotViewport,
} from "@ryot-app/plugin-client-sdk/plugin";
import {
	ManagedAssetProvider,
	type RyotQuery,
	type RyotQueryResult,
	type Text,
	useEntitySettle,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { tabId, type TabOption, Tabs } from "@ryot-app/plugin-ui-sdk";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { type MediaCopy, type MediaText, useMediaCopy } from "../messages";
import { MediaOverview, type MediaOverviewRelationsRender } from "./overview";
import { mapMediaOverview, type MediaOverviewState } from "./overview-state";
import { MediaPopulationFailure, MediaTranslationFailure } from "./population-failure";
import { MediaRefreshStatus, MediaStatusMessage } from "./primitives";
import { MediaSummaryHeader, MediaSummarySkeleton } from "./summary-header";
import {
	type MediaEntitySummaryValue,
	mediaManagedAssets,
	type MediaSummaryArtwork,
	type MediaSummaryFailure,
	type MediaSummaryHeaderDetail,
	type MediaSummaryState,
	type MediaSummaryUnavailableReason,
} from "./summary-state";

export type MediaStatusCopy = { readonly title: Text; readonly detail: Text };

export type MediaDetailBodyInput<Summary, Overview> = {
	readonly entityId: string;
	readonly compact: boolean;
	readonly safeAreaTop: number;
	readonly refresh: () => void;
	readonly refreshOverview: () => void;
	readonly summaryRefreshStatus: ReactNode;
	readonly overviewRefreshStatus: ReactNode;
	readonly state: MediaSummaryState<Summary>;
	readonly overview: MediaOverviewState<Overview>;
	readonly settled: undefined | EntitySettleReason;
};

const MEDIA_DETAIL_PANEL_ID = "media-detail-panel";

const useMediaEntitySettle = (entityId: string) =>
	useEntitySettle(useMemo(() => ({ visible: [], foreground: [entityId] }), [entityId]));

type MediaDetailBodyRender<Summary, Overview> = (
	input: MediaDetailBodyInput<Summary, Overview>,
) => ReactNode;

type MediaDetailScreenBase<SummaryData, Summary> = {
	readonly entityId: string;
	readonly summaryQuery: RyotQuery<{ readonly entityId: string }, SummaryData>;
	readonly mapSummary: (result: RyotQueryResult<SummaryData>) => MediaSummaryState<Summary>;
};

export function MediaDetailBody<
	Summary extends MediaEntitySummaryValue,
	Overview,
	TabKey extends string,
>(props: {
	readonly compact: boolean;
	readonly defaultTab: TabKey;
	readonly overviewTab: TabKey;
	readonly safeAreaTop: number;
	readonly refresh: () => void;
	readonly refreshOverview: () => void;
	readonly artwork: MediaSummaryArtwork;
	readonly summaryRefreshStatus: ReactNode;
	readonly overviewRefreshStatus: ReactNode;
	readonly overviewNoticeTitle: LocalMessage;
	readonly state: MediaSummaryState<Summary>;
	readonly tabs: readonly TabOption<TabKey>[];
	readonly overviewLoadingDetail: LocalMessage;
	readonly overview: MediaOverviewState<Overview>;
	readonly settled: undefined | EntitySettleReason;
	readonly overviewEmpty?: undefined | MediaStatusCopy;
	readonly loading: (text: MediaText) => MediaStatusCopy;
	readonly tabContent: Partial<Record<TabKey, ReactNode>>;
	readonly overviewIsEmpty: (overview: Overview) => boolean;
	readonly overviewRelations: MediaOverviewRelationsRender<Overview>;
	readonly header: (summary: Summary, copy: MediaCopy) => MediaSummaryHeaderDetail;
	readonly summaryError: (text: MediaText, state: MediaSummaryFailure) => MediaStatusCopy;
	readonly summaryUnavailable: (
		text: MediaText,
		reason: MediaSummaryUnavailableReason,
	) => MediaStatusCopy;
	readonly overviewTrailing?:
		undefined | ((input: { readonly summary: Summary; readonly compact: boolean }) => ReactNode);
}) {
	const copy = useMediaCopy();
	const loading = props.loading(copy.text);
	const { state, overviewTrailing } = props;
	const [activeTab, setActiveTab] = useState<TabKey>(props.defaultTab);
	if (state.status === "loading") {
		return (
			<MediaSummarySkeleton title={loading.title} compact={props.compact} detail={loading.detail} />
		);
	}
	if (state.status === "transport-error" || state.status === "malformed") {
		return <MediaStatusMessage {...props.summaryError(copy.text, state)} onRetry={props.refresh} />;
	}
	if (state.status === "unavailable") {
		return (
			<>
				{props.summaryRefreshStatus}
				<MediaStatusMessage {...props.summaryUnavailable(copy.text, state.reason)} />
			</>
		);
	}
	const { summary } = state;
	return (
		<div className="grid grid-cols-[minmax(0,1fr)] gap-7">
			{props.summaryRefreshStatus}
			{summary.populationStatus.state === "failed" ? (
				<MediaPopulationFailure entityId={summary.id} providerName={summary.providerName} />
			) : null}
			{summary.translationStatus.state === "failed" ? (
				<MediaTranslationFailure entityId={summary.id} />
			) : null}
			<MediaSummaryHeader
				media={summary}
				compact={props.compact}
				settled={props.settled}
				artwork={props.artwork}
				detail={props.header(summary, copy)}
			/>
			<Tabs
				value={activeTab}
				options={props.tabs}
				onChange={setActiveTab}
				panelId={MEDIA_DETAIL_PANEL_ID}
				label={copy.text("detail.sections-label")}
			/>
			<div
				role="tabpanel"
				id={MEDIA_DETAIL_PANEL_ID}
				aria-labelledby={tabId(MEDIA_DETAIL_PANEL_ID, activeTab)}
			>
				{activeTab === props.overviewTab ? (
					<MediaOverview
						media={summary}
						compact={props.compact}
						overview={props.overview}
						empty={props.overviewEmpty}
						isEmpty={props.overviewIsEmpty}
						safeAreaTop={props.safeAreaTop}
						relations={props.overviewRelations}
						refreshOverview={props.refreshOverview}
						noticeTitle={props.overviewNoticeTitle}
						refreshStatus={props.overviewRefreshStatus}
						loadingDetail={props.overviewLoadingDetail}
						trailing={
							overviewTrailing === undefined
								? undefined
								: (input) => overviewTrailing({ ...input, summary })
						}
					/>
				) : (
					props.tabContent[activeTab]
				)}
			</div>
		</div>
	);
}

function MediaQueriedDetailScreen<
	SummaryData,
	OverviewData,
	Summary extends MediaEntitySummaryValue,
>(
	props: MediaDetailScreenBase<SummaryData, Summary> & {
		readonly Body: MediaDetailBodyRender<Summary, OverviewData>;
		readonly overviewQuery: RyotQuery<{ readonly entityId: string }, OverviewData>;
		readonly overviewAssets: (overview: OverviewData) => readonly ManagedAssetLocator[];
	},
) {
	const overviewResult = useRyotQuery(props.overviewQuery, { entityId: props.entityId });
	const overview = mapMediaOverview(overviewResult);
	return (
		<MediaDetailFrame
			Body={props.Body}
			overview={overview}
			entityId={props.entityId}
			mapSummary={props.mapSummary}
			summaryQuery={props.summaryQuery}
			overviewData={overviewResult.data}
			refreshOverview={overviewResult.refetch}
			overviewRefreshStatus={<MediaRefreshStatus result={overviewResult} />}
			overviewLocators={overview.status === "ready" ? props.overviewAssets(overview.overview) : []}
		/>
	);
}

function MediaDetailFrame<SummaryData, OverviewData, Summary extends MediaEntitySummaryValue>(
	props: MediaDetailScreenBase<SummaryData, Summary> & {
		readonly overviewData: unknown;
		readonly refreshOverview: () => void;
		readonly overviewRefreshStatus: ReactNode;
		readonly overview: MediaOverviewState<OverviewData>;
		readonly overviewLocators: readonly ManagedAssetLocator[];
		readonly Body: MediaDetailBodyRender<Summary, OverviewData>;
	},
) {
	const { compact, safeAreaTop } = useRyotViewport();
	const summaryResult = useRyotQuery(props.summaryQuery, { entityId: props.entityId });
	const { commit, settled } = useMediaEntitySettle(props.entityId);
	useEffect(() => {
		if (summaryResult.data !== undefined || props.overviewData !== undefined) {
			commit();
		}
	}, [commit, summaryResult.data, props.overviewData]);
	const state = props.mapSummary(summaryResult);
	const assets = state.status === "ready" ? mediaManagedAssets(state.summary) : [];
	return (
		<ManagedAssetProvider assets={assets}>
			<PluginScreenFrame hideTitle title={state.status === "ready" ? state.summary.name : null}>
				<ManagedAssetProvider assets={props.overviewLocators}>
					<props.Body
						state={state}
						compact={compact}
						entityId={props.entityId}
						overview={props.overview}
						safeAreaTop={safeAreaTop}
						refresh={summaryResult.refetch}
						settled={settled.get(props.entityId)}
						refreshOverview={props.refreshOverview}
						overviewRefreshStatus={props.overviewRefreshStatus}
						summaryRefreshStatus={<MediaRefreshStatus result={summaryResult} />}
					/>
				</ManagedAssetProvider>
			</PluginScreenFrame>
		</ManagedAssetProvider>
	);
}

const NO_OVERVIEW: MediaOverviewState<undefined> = { status: "ready", overview: undefined };

const refreshNothing = () => undefined;

/** The detail screen; without an overview query the overview is ready and empty, and never refetches. */
export function MediaDetailScreen<
	SummaryData,
	OverviewData,
	Summary extends MediaEntitySummaryValue,
>(
	props: MediaDetailScreenBase<SummaryData, Summary> &
		(
			| {
					readonly overviewQuery?: undefined;
					readonly overviewAssets?: undefined;
					readonly Body: MediaDetailBodyRender<Summary, undefined>;
			  }
			| {
					readonly Body: MediaDetailBodyRender<Summary, OverviewData>;
					readonly overviewQuery: RyotQuery<{ readonly entityId: string }, OverviewData>;
					readonly overviewAssets: (overview: OverviewData) => readonly ManagedAssetLocator[];
			  }
		),
) {
	if (props.overviewQuery !== undefined) {
		return <MediaQueriedDetailScreen {...props} overviewQuery={props.overviewQuery} />;
	}
	return (
		<MediaDetailFrame
			Body={props.Body}
			overviewLocators={[]}
			overview={NO_OVERVIEW}
			overviewData={undefined}
			entityId={props.entityId}
			overviewRefreshStatus={null}
			mapSummary={props.mapSummary}
			refreshOverview={refreshNothing}
			summaryQuery={props.summaryQuery}
		/>
	);
}

export const mediaDetailPage = (Screen: (props: EntityRendererProps) => ReactNode) => () => {
	const location = usePluginLocation();
	if (location.kind !== "entity") {
		return null;
	}
	return <Screen entityId={location.entityId} entitySchemaSlug={location.entitySchemaSlug} />;
};
