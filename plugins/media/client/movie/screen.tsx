import type { EntitySettleReason } from "@ryot-app/client-sdk";
import {
	usePluginLocation,
	useRyotViewport,
	type EntityRendererProps,
} from "@ryot-app/client-sdk/plugin";
import { ManagedAssetProvider, useRyotQuery } from "@ryot-app/client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/client-sdk/screen";
import { useEffect, useState, type ReactNode } from "react";

import { MEDIA_ART_HEIGHT, MEDIA_BACKDROP_HEIGHT, MediaHero } from "../media/hero";
import { MediaOverview } from "../media/overview";
import { mapMediaOverview, type MediaOverviewState } from "../media/overview-state";
import { MediaRefreshStatus, MediaStatusMessage } from "../media/primitives";
import { MediaSummaryHeader } from "../media/summary-header";
import { mediaManagedAssets } from "../media/summary-state";
import { MediaTabBar, type MediaTab } from "../media/tabs";
import { MovieActivityTab } from "./activity";
import {
	movieOverviewManagedAssets,
	movieOverviewIsEmpty,
	movieOverviewRelations,
	type MovieOverview,
} from "./overview";
import { movieOverviewQuery, movieSummaryQuery, useMovieEntitySettle } from "./queries";
import {
	mapMovieSummary,
	movieLifecycleLabel,
	movieSummaryError,
	movieSummaryFacts,
	movieSummaryProgress,
	movieSummaryUnavailable,
	MOVIE_TYPE_LABEL,
	type MovieSummaryState,
} from "./summary-state";

type MovieTabKey = "overview" | "activity";

const MOVIE_TABS: readonly MediaTab<MovieTabKey>[] = [
	{ key: "overview", label: "Overview" },
	{ key: "activity", label: "Activity" },
];

export function MovieScreenBody(props: {
	readonly compact: boolean;
	readonly refresh: () => void;
	readonly activity: ReactNode;
	readonly state: MovieSummaryState;
	readonly refreshOverview: () => void;
	readonly summaryRefreshStatus?: ReactNode;
	readonly overviewRefreshStatus?: ReactNode;
	readonly settled: EntitySettleReason | undefined;
	readonly overview: MediaOverviewState<MovieOverview>;
}) {
	const { state } = props;
	const [activeTab, setActiveTab] = useState<MovieTabKey>("overview");
	if (state.status === "loading") {
		return (
			<MediaStatusMessage
				title="Loading movie..."
				detail="Fetching the latest details for this movie."
			/>
		);
	}
	if (state.status === "transport-error" || state.status === "malformed") {
		return <MediaStatusMessage {...movieSummaryError(state)} onRetry={props.refresh} />;
	}
	if (state.status === "unavailable") {
		return (
			<>
				{props.summaryRefreshStatus}
				<MediaStatusMessage {...movieSummaryUnavailable(state.reason)} />
			</>
		);
	}
	const tabContent: Record<MovieTabKey, ReactNode> = {
		activity: props.activity,
		overview: (
			<MediaOverview
				media={state.movie}
				compact={props.compact}
				overview={props.overview}
				isEmpty={movieOverviewIsEmpty}
				relations={movieOverviewRelations}
				refreshOverview={props.refreshOverview}
				refreshStatus={props.overviewRefreshStatus}
				loadingDetail="Fetching the cast, companies and recommendations for this movie."
			/>
		),
	};
	return (
		<div className="flex flex-col gap-4">
			{props.summaryRefreshStatus}
			<MediaSummaryHeader
				media={state.movie}
				compact={props.compact}
				settled={props.settled}
				typeLabel={MOVIE_TYPE_LABEL}
				facts={movieSummaryFacts(state.movie)}
				progress={movieSummaryProgress(state.movie)}
				lifecycleLabel={movieLifecycleLabel(state.movie.state)}
			/>
			<MediaTabBar
				tabs={MOVIE_TABS}
				activeTab={activeTab}
				compact={props.compact}
				onSelect={setActiveTab}
			/>
			{tabContent[activeTab]}
		</div>
	);
}

export function MovieScreen(props: EntityRendererProps) {
	const { compact } = useRyotViewport();
	const summaryResult = useRyotQuery(movieSummaryQuery, { entityId: props.entityId });
	const overviewResult = useRyotQuery(movieOverviewQuery, { entityId: props.entityId });
	const { commit, settled } = useMovieEntitySettle(props.entityId);
	useEffect(() => {
		commit();
	}, [commit, summaryResult.data, overviewResult.data]);
	const state = mapMovieSummary(summaryResult);
	const overview = mapMediaOverview(overviewResult);
	const assets = state.status === "ready" ? mediaManagedAssets(state.movie) : [];
	const overviewAssets =
		overview.status === "ready" ? movieOverviewManagedAssets(overview.overview) : [];
	return (
		<ManagedAssetProvider assets={assets}>
			<PluginScreenFrame
				hideTitle
				title={state.status === "ready" ? state.movie.name : null}
				hero={
					state.status === "ready"
						? {
								node: <MediaHero compact={compact} media={state.movie} />,
								height: compact ? MEDIA_ART_HEIGHT : MEDIA_BACKDROP_HEIGHT,
							}
						: undefined
				}
			>
				<ManagedAssetProvider assets={overviewAssets}>
					<MovieScreenBody
						state={state}
						compact={compact}
						overview={overview}
						refresh={summaryResult.refetch}
						settled={settled.get(props.entityId)}
						refreshOverview={overviewResult.refetch}
						summaryRefreshStatus={<MediaRefreshStatus result={summaryResult} />}
						overviewRefreshStatus={<MediaRefreshStatus result={overviewResult} />}
						activity={<MovieActivityTab compact={compact} entityId={props.entityId} />}
					/>
				</ManagedAssetProvider>
			</PluginScreenFrame>
		</ManagedAssetProvider>
	);
}

const MovieDetailPage = () => {
	const location = usePluginLocation();
	if (location.kind !== "entity") {
		return null;
	}
	return <MovieScreen entityId={location.entityId} entitySchemaSlug={location.entitySchemaSlug} />;
};

export default MovieDetailPage;
