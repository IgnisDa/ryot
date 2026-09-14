import type { EntitySettleReason, ManagedAssetLocator } from "@ryot-app/client-sdk";
import {
	usePluginLocation,
	useRyotViewport,
	type EntityRendererProps,
} from "@ryot-app/client-sdk/plugin";
import {
	ManagedAssetProvider,
	useEntitySettle,
	useRyotQuery,
	type RyotQuery,
	type RyotQueryResult,
} from "@ryot-app/client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/client-sdk/screen";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { MediaHero } from "./hero";
import { MediaOverview, type MediaOverviewRelationsRender } from "./overview";
import { mapMediaOverview, type MediaOverviewState } from "./overview-state";
import { MediaRefreshStatus, MediaStatusMessage } from "./primitives";
import { MediaSummaryHeader, type MediaSummaryValue } from "./summary-header";
import {
	mediaManagedAssets,
	type MediaSummaryFact,
	type MediaSummaryFailure,
	type MediaSummaryState,
	type MediaSummaryUnavailableReason,
} from "./summary-state";
import { MediaTabBar, type MediaTab } from "./tabs";
import type { MediaWatchProviders } from "./watch-providers";

export type MediaStatusCopy = { readonly title: string; readonly detail: string };

export type MediaDetailBodyInput<Summary, Overview> = {
	readonly entityId: string;
	readonly compact: boolean;
	readonly safeAreaTop: number;
	readonly refresh: () => void;
	readonly refreshOverview: () => void;
	readonly summaryRefreshStatus: ReactNode;
	readonly overviewRefreshStatus: ReactNode;
	readonly settled: EntitySettleReason | undefined;
	readonly state: MediaSummaryState<Summary>;
	readonly overview: MediaOverviewState<Overview>;
};

const useMediaEntitySettle = (entityId: string) =>
	useEntitySettle(useMemo(() => ({ visible: [], foreground: [entityId] }), [entityId]));

export function MediaDetailBody<
	Summary extends MediaSummaryValue,
	Overview,
	TabKey extends string,
>(props: {
	readonly compact: boolean;
	readonly typeLabel: string;
	readonly overviewTab: TabKey;
	readonly safeAreaTop: number;
	readonly refresh: () => void;
	readonly loading: MediaStatusCopy;
	readonly refreshOverview: () => void;
	readonly overviewNoticeTitle: string;
	readonly overviewLoadingDetail: string;
	readonly summaryRefreshStatus: ReactNode;
	readonly overviewRefreshStatus: ReactNode;
	readonly tabs: readonly MediaTab<TabKey>[];
	readonly state: MediaSummaryState<Summary>;
	readonly overview: MediaOverviewState<Overview>;
	readonly settled: EntitySettleReason | undefined;
	readonly tabContent: Partial<Record<TabKey, ReactNode>>;
	readonly lifecycleLabel: (summary: Summary) => string;
	readonly overviewIsEmpty: (overview: Overview) => boolean;
	readonly summaryError: (state: MediaSummaryFailure) => MediaStatusCopy;
	readonly facts: (summary: Summary) => readonly MediaSummaryFact[];
	readonly overviewRelations: MediaOverviewRelationsRender<Overview>;
	readonly summaryUnavailable: (reason: MediaSummaryUnavailableReason) => MediaStatusCopy;
	readonly progress?: (summary: Summary) => { readonly percent: number } | undefined;
	readonly watchProviders?: ((summary: Summary) => MediaWatchProviders | undefined) | undefined;
}) {
	const { state } = props;
	const [activeTab, setActiveTab] = useState<TabKey>(props.overviewTab);
	if (state.status === "loading") {
		return <MediaStatusMessage title={props.loading.title} detail={props.loading.detail} />;
	}
	if (state.status === "transport-error" || state.status === "malformed") {
		return <MediaStatusMessage {...props.summaryError(state)} onRetry={props.refresh} />;
	}
	if (state.status === "unavailable") {
		return (
			<>
				{props.summaryRefreshStatus}
				<MediaStatusMessage {...props.summaryUnavailable(state.reason)} />
			</>
		);
	}
	const { summary } = state;
	return (
		<div className="flex flex-col gap-4">
			{props.summaryRefreshStatus}
			<MediaSummaryHeader
				media={summary}
				compact={props.compact}
				settled={props.settled}
				typeLabel={props.typeLabel}
				facts={props.facts(summary)}
				progress={props.progress?.(summary)}
				lifecycleLabel={props.lifecycleLabel(summary)}
			/>
			<MediaTabBar
				tabs={props.tabs}
				activeTab={activeTab}
				compact={props.compact}
				onSelect={setActiveTab}
			/>
			{activeTab === props.overviewTab ? (
				<MediaOverview
					media={summary}
					compact={props.compact}
					overview={props.overview}
					isEmpty={props.overviewIsEmpty}
					safeAreaTop={props.safeAreaTop}
					relations={props.overviewRelations}
					refreshOverview={props.refreshOverview}
					noticeTitle={props.overviewNoticeTitle}
					refreshStatus={props.overviewRefreshStatus}
					loadingDetail={props.overviewLoadingDetail}
					watchProviders={props.watchProviders?.(summary)}
				/>
			) : (
				props.tabContent[activeTab]
			)}
		</div>
	);
}

export function MediaDetailScreen<
	SummaryData,
	OverviewData,
	Summary extends MediaSummaryValue,
>(props: {
	readonly entityId: string;
	readonly heroHeight: (compact: boolean) => number;
	readonly summaryQuery: RyotQuery<{ readonly entityId: string }, SummaryData>;
	readonly overviewQuery: RyotQuery<{ readonly entityId: string }, OverviewData>;
	readonly mapSummary: (result: RyotQueryResult<SummaryData>) => MediaSummaryState<Summary>;
	readonly overviewAssets: (overview: OverviewData) => readonly ManagedAssetLocator[];
	readonly Body: (input: MediaDetailBodyInput<Summary, OverviewData>) => ReactNode;
}) {
	const { compact, safeAreaTop } = useRyotViewport();
	const summaryResult = useRyotQuery(props.summaryQuery, { entityId: props.entityId });
	const overviewResult = useRyotQuery(props.overviewQuery, { entityId: props.entityId });
	const { commit, settled } = useMediaEntitySettle(props.entityId);
	useEffect(() => {
		commit();
	}, [commit, summaryResult.data, overviewResult.data]);
	const state = props.mapSummary(summaryResult);
	const overview = mapMediaOverview(overviewResult);
	const assets = state.status === "ready" ? mediaManagedAssets(state.summary) : [];
	const overviewAssets = overview.status === "ready" ? props.overviewAssets(overview.overview) : [];
	return (
		<ManagedAssetProvider assets={assets}>
			<PluginScreenFrame
				hideTitle
				title={state.status === "ready" ? state.summary.name : null}
				hero={
					state.status === "ready"
						? {
								height: props.heroHeight(compact),
								node: <MediaHero compact={compact} media={state.summary} />,
							}
						: undefined
				}
			>
				<ManagedAssetProvider assets={overviewAssets}>
					<props.Body
						state={state}
						compact={compact}
						overview={overview}
						entityId={props.entityId}
						safeAreaTop={safeAreaTop}
						refresh={summaryResult.refetch}
						settled={settled.get(props.entityId)}
						refreshOverview={overviewResult.refetch}
						summaryRefreshStatus={<MediaRefreshStatus result={summaryResult} />}
						overviewRefreshStatus={<MediaRefreshStatus result={overviewResult} />}
					/>
				</ManagedAssetProvider>
			</PluginScreenFrame>
		</ManagedAssetProvider>
	);
}

export const mediaDetailPage = (Screen: (props: EntityRendererProps) => ReactNode) => () => {
	const location = usePluginLocation();
	if (location.kind !== "entity") {
		return null;
	}
	return <Screen entityId={location.entityId} entitySchemaSlug={location.entitySchemaSlug} />;
};
