import type { EntitySettleReason } from "@ryot-app/client-sdk";
import type { EntityRendererProps } from "@ryot-app/client-sdk/plugin";
import type { ReactNode } from "react";

import {
	MediaDetailBody,
	MediaDetailScreen,
	mediaDetailPage,
	type MediaDetailBodyInput,
	type MediaStatusCopy,
} from "../media/detail-screen";
import { MEDIA_ART_HEIGHT, MEDIA_BACKDROP_HEIGHT } from "../media/hero";
import type { MediaOverviewState } from "../media/overview-state";
import type { MediaTab } from "../media/tabs";
import { MovieActivityTab } from "./activity";
import {
	movieOverviewIsEmpty,
	movieOverviewManagedAssets,
	movieOverviewRelations,
	type MovieOverview,
} from "./overview";
import { movieOverviewQuery, movieSummaryQuery } from "./queries";
import {
	mapMovieSummary,
	movieLifecycleLabel,
	movieSummaryError,
	movieSummaryFacts,
	movieSummaryProgress,
	movieSummaryUnavailable,
	MOVIE_TYPE_LABEL,
	type MovieSummary,
	type MovieSummaryState,
} from "./summary-state";

type MovieTabKey = "overview" | "activity";

const MOVIE_TABS: readonly MediaTab<MovieTabKey>[] = [
	{ key: "overview", label: "Overview" },
	{ key: "activity", label: "Activity" },
];

const MOVIE_LOADING: MediaStatusCopy = {
	title: "Loading movie...",
	detail: "Fetching the latest details for this movie.",
};

export function MovieScreenBody(props: {
	readonly compact: boolean;
	readonly safeAreaTop: number;
	readonly refresh: () => void;
	readonly activity: ReactNode;
	readonly state: MovieSummaryState;
	readonly refreshOverview: () => void;
	readonly summaryRefreshStatus?: ReactNode;
	readonly overviewRefreshStatus?: ReactNode;
	readonly settled: EntitySettleReason | undefined;
	readonly overview: MediaOverviewState<MovieOverview>;
}) {
	return (
		<MediaDetailBody
			tabs={MOVIE_TABS}
			state={props.state}
			overviewTab="overview"
			loading={MOVIE_LOADING}
			compact={props.compact}
			settled={props.settled}
			refresh={props.refresh}
			facts={movieSummaryFacts}
			overview={props.overview}
			typeLabel={MOVIE_TYPE_LABEL}
			progress={movieSummaryProgress}
			safeAreaTop={props.safeAreaTop}
			summaryError={movieSummaryError}
			watchProviders={(movie) => movie}
			overviewIsEmpty={movieOverviewIsEmpty}
			refreshOverview={props.refreshOverview}
			tabContent={{ activity: props.activity }}
			overviewRelations={movieOverviewRelations}
			summaryUnavailable={movieSummaryUnavailable}
			summaryRefreshStatus={props.summaryRefreshStatus}
			overviewRefreshStatus={props.overviewRefreshStatus}
			lifecycleLabel={(movie: MovieSummary) => movieLifecycleLabel(movie.state)}
			overviewLoadingDetail="Fetching the cast, companies and recommendations for this movie."
		/>
	);
}

function MovieDetailBody(input: MediaDetailBodyInput<MovieSummary, MovieOverview>) {
	return (
		<MovieScreenBody
			{...input}
			activity={<MovieActivityTab compact={input.compact} entityId={input.entityId} />}
		/>
	);
}

export function MovieScreen(props: EntityRendererProps) {
	return (
		<MediaDetailScreen
			Body={MovieDetailBody}
			entityId={props.entityId}
			mapSummary={mapMovieSummary}
			summaryQuery={movieSummaryQuery}
			overviewQuery={movieOverviewQuery}
			overviewAssets={movieOverviewManagedAssets}
			heroHeight={(compact) => (compact ? MEDIA_ART_HEIGHT : MEDIA_BACKDROP_HEIGHT)}
		/>
	);
}

export default mediaDetailPage(MovieScreen);
