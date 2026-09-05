import type { EntitySettleReason } from "@ryot-app/client-sdk";
import type { EntityRendererProps } from "@ryot-app/client-sdk/plugin";
import type { ReactNode } from "react";

import type { MediaOverviewRows } from "../../shared/media-recipes";
import {
	MediaDetailBody,
	MediaDetailScreen,
	mediaDetailPage,
	type MediaDetailBodyInput,
	type MediaStatusCopy,
} from "../media/detail-screen";
import { MEDIA_ART_HEIGHT, MEDIA_BACKDROP_HEIGHT } from "../media/hero";
import {
	MediaOverviewRelations,
	type MediaCreditCopy,
	type MediaOverviewRelationsRender,
} from "../media/overview";
import {
	mediaOverviewManagedAssets,
	mediaRelationsAreEmpty,
	type MediaOverviewState,
} from "../media/overview-state";
import { mediaRatingFact } from "../media/summary-state";
import type { MediaTab } from "../media/tabs";
import { ShowActivityTab } from "./activity";
import { ShowEpisodesTab } from "./episodes";
import { showOverviewQuery, showSummaryQuery } from "./queries";
import {
	mapShowSummary,
	showEpisodeFact,
	showLifecycleLabel,
	showSeasonFact,
	showSummaryError,
	showSummaryUnavailable,
	SHOW_TYPE_LABEL,
	type ShowSummary,
	type ShowSummaryState,
} from "./summary-state";

type ShowTabKey = "overview" | "episodes" | "activity";

const SHOW_TABS: readonly MediaTab<ShowTabKey>[] = [
	{ key: "overview", label: "Overview" },
	{ key: "episodes", label: "Episodes" },
	{ key: "activity", label: "Activity" },
];

const SHOW_LOADING: MediaStatusCopy = {
	title: "Loading show...",
	detail: "Fetching the latest details for this show.",
};

const SHOW_CREDIT_COPY: MediaCreditCopy = {
	people: "Cast & crew",
	companies: "Production companies",
	notice: "Cast, companies and recommendations",
};

const showOverviewRelations: MediaOverviewRelationsRender<MediaOverviewRows> = ({
	compact,
	divided,
	overview,
}) => (
	<MediaOverviewRelations
		compact={compact}
		divided={divided}
		overview={overview}
		copy={SHOW_CREDIT_COPY}
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
	return (
		<MediaDetailBody
			tabs={SHOW_TABS}
			state={props.state}
			overviewTab="overview"
			loading={SHOW_LOADING}
			compact={props.compact}
			settled={props.settled}
			refresh={props.refresh}
			facts={showSummaryFacts}
			overview={props.overview}
			typeLabel={SHOW_TYPE_LABEL}
			safeAreaTop={props.safeAreaTop}
			summaryError={showSummaryError}
			watchProviders={(show) => show}
			refreshOverview={props.refreshOverview}
			overviewIsEmpty={mediaRelationsAreEmpty}
			overviewRelations={showOverviewRelations}
			summaryUnavailable={showSummaryUnavailable}
			overviewNoticeTitle={SHOW_CREDIT_COPY.notice}
			summaryRefreshStatus={props.summaryRefreshStatus}
			overviewRefreshStatus={props.overviewRefreshStatus}
			tabContent={{ episodes: props.episodes, activity: props.activity }}
			lifecycleLabel={(show: ShowSummary) => showLifecycleLabel(show.state)}
			overviewLoadingDetail="Fetching the cast, companies and recommendations for this show."
		/>
	);
}

function ShowDetailBody(input: MediaDetailBodyInput<ShowSummary, MediaOverviewRows>) {
	return (
		<ShowScreenBody
			{...input}
			episodes={<ShowEpisodesTab compact={input.compact} entityId={input.entityId} />}
			activity={<ShowActivityTab compact={input.compact} entityId={input.entityId} />}
		/>
	);
}

export function ShowScreen(props: EntityRendererProps) {
	return (
		<MediaDetailScreen
			Body={ShowDetailBody}
			entityId={props.entityId}
			mapSummary={mapShowSummary}
			summaryQuery={showSummaryQuery}
			overviewQuery={showOverviewQuery}
			overviewAssets={mediaOverviewManagedAssets}
			heroHeight={(compact) => (compact ? MEDIA_ART_HEIGHT : MEDIA_BACKDROP_HEIGHT)}
		/>
	);
}

export default mediaDetailPage(ShowScreen);
