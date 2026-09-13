import type { EntitySettleReason } from "@ryot-app/client-sdk";
import {
	usePluginLocation,
	useRyotViewport,
	type EntityRendererProps,
} from "@ryot-app/client-sdk/plugin";
import { ManagedAssetProvider, useRyotQuery } from "@ryot-app/client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/client-sdk/screen";
import { useEffect, useState, type ReactNode } from "react";

import type { MediaOverviewRows } from "../../shared/media-recipes";
import { MEDIA_ART_HEIGHT, MEDIA_BACKDROP_HEIGHT, MediaHero } from "../media/hero";
import {
	MediaOverview,
	MediaOverviewRelations,
	type MediaOverviewRelationsRender,
} from "../media/overview";
import {
	mapMediaOverview,
	mediaOverviewManagedAssets,
	mediaRelationsAreEmpty,
	type MediaOverviewState,
} from "../media/overview-state";
import { MediaRefreshStatus, MediaStatusMessage } from "../media/primitives";
import { MediaSummaryHeader } from "../media/summary-header";
import { mediaManagedAssets, mediaRatingFact } from "../media/summary-state";
import { MediaTabBar, type MediaTab } from "../media/tabs";
import { ShowActivityTab } from "./activity";
import { ShowEpisodesTab } from "./episodes";
import { showOverviewQuery, showSummaryQuery, useShowEntitySettle } from "./queries";
import {
	mapShowSummary,
	showEpisodeFact,
	showLifecycleLabel,
	showSeasonFact,
	showSummaryError,
	showSummaryUnavailable,
	type ShowSummary,
	type ShowSummaryState,
} from "./summary-state";

const SHOW_TYPE_LABEL = "TV Show";

type ShowTabKey = "overview" | "episodes" | "activity";

const SHOW_TABS: readonly MediaTab<ShowTabKey>[] = [
	{ key: "overview", label: "Overview" },
	{ key: "episodes", label: "Episodes" },
	{ key: "activity", label: "Activity" },
];

const showOverviewRelations: MediaOverviewRelationsRender<MediaOverviewRows> = ({
	compact,
	divided,
	overview,
}) => (
	<MediaOverviewRelations
		compact={compact}
		divided={divided}
		overview={overview}
		onViewAllPeople={() => console.log("TODO: open all show credits")}
	/>
);

const showSummaryFacts = (show: ShowSummary) => {
	const seasons = showSeasonFact(show);
	const episodes = showEpisodeFact(show);
	return [
		mediaRatingFact(show),
		show.productionStatus === null
			? undefined
			: { icon: "clapperboard", label: "Production status", value: show.productionStatus },
		seasons === undefined ? undefined : { icon: "layers-3", ...seasons },
		episodes === undefined ? undefined : { icon: "tv", ...episodes },
	].filter((fact) => fact !== undefined);
};

export function ShowScreenBody(props: {
	readonly compact: boolean;
	readonly safeAreaTop: number;
	readonly refresh: () => void;
	readonly episodes: ReactNode;
	readonly activity: ReactNode;
	readonly state: ShowSummaryState;
	readonly refreshOverview: () => void;
	readonly summaryRefreshStatus?: ReactNode;
	readonly overviewRefreshStatus?: ReactNode;
	readonly settled: EntitySettleReason | undefined;
	readonly overview: MediaOverviewState<MediaOverviewRows>;
}) {
	const { state } = props;
	const [activeTab, setActiveTab] = useState<ShowTabKey>("overview");
	if (state.status === "loading") {
		return (
			<MediaStatusMessage
				title="Loading show..."
				detail="Fetching the latest details for this show."
			/>
		);
	}
	if (state.status === "transport-error" || state.status === "malformed") {
		return <MediaStatusMessage {...showSummaryError(state)} onRetry={props.refresh} />;
	}
	if (state.status === "unavailable") {
		return (
			<>
				{props.summaryRefreshStatus}
				<MediaStatusMessage {...showSummaryUnavailable(state.reason)} />
			</>
		);
	}
	const tabContent: Record<ShowTabKey, ReactNode> = {
		episodes: props.episodes,
		activity: props.activity,
		overview: (
			<MediaOverview
				media={state.show}
				compact={props.compact}
				overview={props.overview}
				safeAreaTop={props.safeAreaTop}
				isEmpty={mediaRelationsAreEmpty}
				relations={showOverviewRelations}
				refreshOverview={props.refreshOverview}
				refreshStatus={props.overviewRefreshStatus}
				loadingDetail="Fetching the cast, companies and recommendations for this show."
			/>
		),
	};
	return (
		<div className="flex flex-col gap-4">
			{props.summaryRefreshStatus}
			<MediaSummaryHeader
				media={state.show}
				compact={props.compact}
				settled={props.settled}
				typeLabel={SHOW_TYPE_LABEL}
				facts={showSummaryFacts(state.show)}
				lifecycleLabel={showLifecycleLabel(state.show.state)}
			/>
			<MediaTabBar
				tabs={SHOW_TABS}
				activeTab={activeTab}
				compact={props.compact}
				onSelect={setActiveTab}
			/>
			{tabContent[activeTab]}
		</div>
	);
}

export function ShowScreen(props: EntityRendererProps) {
	const { compact, safeAreaTop } = useRyotViewport();
	const summaryResult = useRyotQuery(showSummaryQuery, { entityId: props.entityId });
	const overviewResult = useRyotQuery(showOverviewQuery, { entityId: props.entityId });
	const { commit, settled } = useShowEntitySettle(props.entityId);
	useEffect(() => {
		commit();
	}, [commit, summaryResult.data, overviewResult.data]);
	const state = mapShowSummary(summaryResult);
	const overview = mapMediaOverview(overviewResult);
	const assets = state.status === "ready" ? mediaManagedAssets(state.show) : [];
	const overviewAssets =
		overview.status === "ready" ? mediaOverviewManagedAssets(overview.overview) : [];
	return (
		<ManagedAssetProvider assets={assets}>
			<PluginScreenFrame
				hideTitle
				title={state.status === "ready" ? state.show.name : null}
				hero={
					state.status === "ready"
						? {
								node: <MediaHero compact={compact} media={state.show} />,
								height: compact ? MEDIA_ART_HEIGHT : MEDIA_BACKDROP_HEIGHT,
							}
						: undefined
				}
			>
				<ManagedAssetProvider assets={overviewAssets}>
					<ShowScreenBody
						state={state}
						compact={compact}
						overview={overview}
						safeAreaTop={safeAreaTop}
						refresh={summaryResult.refetch}
						settled={settled.get(props.entityId)}
						refreshOverview={overviewResult.refetch}
						summaryRefreshStatus={<MediaRefreshStatus result={summaryResult} />}
						overviewRefreshStatus={<MediaRefreshStatus result={overviewResult} />}
						episodes={<ShowEpisodesTab compact={compact} entityId={props.entityId} />}
						activity={<ShowActivityTab compact={compact} entityId={props.entityId} />}
					/>
				</ManagedAssetProvider>
			</PluginScreenFrame>
		</ManagedAssetProvider>
	);
}

const ShowDetailPage = () => {
	const location = usePluginLocation();
	if (location.kind !== "entity") {
		return null;
	}
	return <ShowScreen entityId={location.entityId} entitySchemaSlug={location.entitySchemaSlug} />;
};

export default ShowDetailPage;
