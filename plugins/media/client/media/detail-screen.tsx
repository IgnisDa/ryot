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
import type { MediaImagePurposes } from "./image";
import { MediaOverview, type MediaOverviewRelationsRender } from "./overview";
import { mapMediaOverview, type MediaOverviewState } from "./overview-state";
import { MediaRefreshStatus, MediaStatusMessage } from "./primitives";
import { MediaSummaryHeader } from "./summary-header";
import {
	mediaManagedAssets,
	type MediaEntitySummaryValue,
	type MediaSummaryArtwork,
	type MediaSummaryFailure,
	type MediaSummaryHeaderDetail,
	type MediaSummaryState,
	type MediaSummaryUnavailableReason,
} from "./summary-state";
import { MediaTabBar, type MediaTab } from "./tabs";

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
	Summary extends MediaEntitySummaryValue,
	Overview,
	TabKey extends string,
>(props: {
	readonly compact: boolean;
	readonly typeLabel: string;
	readonly defaultTab: TabKey;
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
	readonly overviewEmpty?: MediaStatusCopy | undefined;
	readonly state: MediaSummaryState<Summary>;
	readonly overview: MediaOverviewState<Overview>;
	readonly settled: EntitySettleReason | undefined;
	readonly artwork: MediaSummaryArtwork;
	readonly tabContent: Partial<Record<TabKey, ReactNode>>;
	readonly overviewIsEmpty: (overview: Overview) => boolean;
	readonly summaryError: (state: MediaSummaryFailure) => MediaStatusCopy;
	readonly header: (summary: Summary) => MediaSummaryHeaderDetail;
	readonly overviewRelations: MediaOverviewRelationsRender<Overview>;
	readonly summaryUnavailable: (reason: MediaSummaryUnavailableReason) => MediaStatusCopy;
	readonly overviewTrailing?:
		| ((input: {
				readonly summary: Summary;
				readonly compact: boolean;
				readonly divided: boolean;
		  }) => ReactNode)
		| undefined;
}) {
	const { state, overviewTrailing } = props;
	const [activeTab, setActiveTab] = useState<TabKey>(props.defaultTab);
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
				artwork={props.artwork}
				typeLabel={props.typeLabel}
				detail={props.header(summary)}
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
	);
}

type MediaDetailBodyRender<Summary, Overview> = (
	input: MediaDetailBodyInput<Summary, Overview>,
) => ReactNode;

type MediaDetailScreenBase<SummaryData, Summary> = {
	readonly entityId: string;
	readonly heroHeight: (compact: boolean) => number;
	readonly posterPurpose?: MediaImagePurposes[number] | undefined;
	readonly backdropPurposes?: MediaImagePurposes | undefined;
	readonly summaryQuery: RyotQuery<{ readonly entityId: string }, SummaryData>;
	readonly mapSummary: (result: RyotQueryResult<SummaryData>) => MediaSummaryState<Summary>;
};

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
		commit();
	}, [commit, summaryResult.data, props.overviewData]);
	const state = props.mapSummary(summaryResult);
	const assets =
		state.status === "ready" ? mediaManagedAssets(state.summary, props.backdropPurposes) : [];
	return (
		<ManagedAssetProvider assets={assets}>
			<PluginScreenFrame
				hideTitle
				title={state.status === "ready" ? state.summary.name : null}
				hero={
					state.status === "ready"
						? {
								height: props.heroHeight(compact),
								node: (
									<MediaHero
										compact={compact}
										media={state.summary}
										posterPurpose={props.posterPurpose}
										backdropPurposes={props.backdropPurposes}
									/>
								),
							}
						: undefined
				}
			>
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
			heroHeight={props.heroHeight}
			mapSummary={props.mapSummary}
			summaryQuery={props.summaryQuery}
			overviewData={overviewResult.data}
			posterPurpose={props.posterPurpose}
			refreshOverview={overviewResult.refetch}
			backdropPurposes={props.backdropPurposes}
			overviewRefreshStatus={<MediaRefreshStatus result={overviewResult} />}
			overviewLocators={overview.status === "ready" ? props.overviewAssets(overview.overview) : []}
		/>
	);
}

const NO_OVERVIEW: MediaOverviewState<Record<never, never>> = { overview: {}, status: "ready" };

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
					readonly Body: MediaDetailBodyRender<Summary, OverviewData>;
					readonly overviewQuery: RyotQuery<{ readonly entityId: string }, OverviewData>;
					readonly overviewAssets: (overview: OverviewData) => readonly ManagedAssetLocator[];
			  }
			| {
					readonly overviewQuery?: undefined;
					readonly overviewAssets?: undefined;
					readonly Body: MediaDetailBodyRender<Summary, Record<never, never>>;
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
			heroHeight={props.heroHeight}
			mapSummary={props.mapSummary}
			refreshOverview={refreshNothing}
			summaryQuery={props.summaryQuery}
			posterPurpose={props.posterPurpose}
			backdropPurposes={props.backdropPurposes}
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
