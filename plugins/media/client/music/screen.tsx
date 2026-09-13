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
import { MEDIA_ART_HEIGHT } from "../media/hero";
import type { MediaOverviewState } from "../media/overview-state";
import type { MediaTab } from "../media/tabs";
import { MusicActivityTab } from "./activity";
import {
	musicOverviewIsEmpty,
	musicOverviewManagedAssets,
	musicOverviewRelations,
	type MusicOverview,
} from "./overview";
import { musicOverviewQuery, musicSummaryQuery } from "./queries";
import {
	mapMusicSummary,
	musicLifecycleLabel,
	musicSummaryError,
	musicSummaryFacts,
	musicSummaryProgress,
	musicSummaryUnavailable,
	MUSIC_TYPE_LABEL,
	type MusicSummary,
	type MusicSummaryState,
} from "./summary-state";

type MusicTabKey = "overview" | "activity";

const MUSIC_TABS: readonly MediaTab<MusicTabKey>[] = [
	{ key: "overview", label: "Overview" },
	{ key: "activity", label: "Activity" },
];

const MUSIC_LOADING: MediaStatusCopy = {
	title: "Loading track...",
	detail: "Fetching the latest details for this track.",
};

export function MusicScreenBody(props: {
	readonly compact: boolean;
	readonly safeAreaTop: number;
	readonly refresh: () => void;
	readonly activity: ReactNode;
	readonly state: MusicSummaryState;
	readonly refreshOverview: () => void;
	readonly summaryRefreshStatus?: ReactNode;
	readonly overviewRefreshStatus?: ReactNode;
	readonly settled: EntitySettleReason | undefined;
	readonly overview: MediaOverviewState<MusicOverview>;
}) {
	return (
		<MediaDetailBody
			tabs={MUSIC_TABS}
			state={props.state}
			overviewTab="overview"
			loading={MUSIC_LOADING}
			compact={props.compact}
			settled={props.settled}
			refresh={props.refresh}
			facts={musicSummaryFacts}
			overview={props.overview}
			typeLabel={MUSIC_TYPE_LABEL}
			progress={musicSummaryProgress}
			safeAreaTop={props.safeAreaTop}
			summaryError={musicSummaryError}
			overviewIsEmpty={musicOverviewIsEmpty}
			refreshOverview={props.refreshOverview}
			tabContent={{ activity: props.activity }}
			overviewRelations={musicOverviewRelations}
			summaryUnavailable={musicSummaryUnavailable}
			summaryRefreshStatus={props.summaryRefreshStatus}
			overviewRefreshStatus={props.overviewRefreshStatus}
			lifecycleLabel={(music: MusicSummary) => musicLifecycleLabel(music.state)}
			overviewLoadingDetail="Fetching the artists, labels and recommendations for this track."
		/>
	);
}

function MusicDetailBody(input: MediaDetailBodyInput<MusicSummary, MusicOverview>) {
	return (
		<MusicScreenBody
			{...input}
			activity={<MusicActivityTab compact={input.compact} entityId={input.entityId} />}
		/>
	);
}

export function MusicScreen(props: EntityRendererProps) {
	return (
		<MediaDetailScreen
			Body={MusicDetailBody}
			entityId={props.entityId}
			mapSummary={mapMusicSummary}
			summaryQuery={musicSummaryQuery}
			overviewQuery={musicOverviewQuery}
			heroHeight={() => MEDIA_ART_HEIGHT}
			overviewAssets={musicOverviewManagedAssets}
		/>
	);
}

export default mediaDetailPage(MusicScreen);
