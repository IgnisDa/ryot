import type { EntitySettleReason } from "@ryot-app/plugin-client-sdk";
import type {
	EntityRendererProps,
	PluginIdentityReference,
} from "@ryot-app/plugin-client-sdk/plugin";
import type { PreparedRecipe } from "@ryot-app/plugin-client-sdk/ryotql";
import type { TabOption } from "@ryot-app/plugin-ui-sdk";
import clsx from "clsx";
import { createElement, type ReactNode } from "react";

import type { MediaPresentationSource } from "../../shared/entity-presentations";
import type { EpisodicActivityInput, EpisodicOverviewInput } from "../../shared/episodic-recipes";
import type { EpisodicLifecycleState } from "../../shared/lifecycle-expressions";
import type { MediaOverviewRows, MediaUnlinkedCreatorsOverview } from "../../shared/media-recipes";
import { createMediaHistoryQuery, type MediaHistoryRecipe } from "./activity-history";
import type { MediaActivityLogger } from "./activity-log/state";
import {
	MediaActivityReviewDetail,
	type MediaActivityRowRender,
	MediaActivityRows,
} from "./activity-rows";
import {
	defineMediaActivityTab,
	type MediaActivityCopy,
	MediaActivityRecord,
} from "./activity-tab";
import { mediaActivitySpanLabel, mediaActivityTimeLabel } from "./activity-timeline";
import { createMediaCreditsQuery, MediaCreditsButton, type MediaCreditsRecipe } from "./credits";
import { createMediaEntityQuery, createMediaSummaryQuery } from "./detail-queries";
import {
	MediaDetailBody,
	type MediaDetailBodyInput,
	mediaDetailPage,
	MediaDetailScreen,
} from "./detail-screen";
import {
	defineMediaPresentationPair,
	type MediaArtworkAspect,
	MediaCardContent,
	type MediaPresentationViewData,
	MediaRowContent,
	type MediaSavedViewPresentationSubject,
} from "./entity-presentation";
import {
	type MediaEpisodicActivityCopy,
	mediaEpisodicActivityRow,
	type MediaEpisodicActivityValue,
	mediaEpisodicActivityView,
	type MediaEpisodicCoverage,
	mediaEpisodicEpisodesLabel,
	type MediaEpisodicEpisodeValue,
	type MediaEpisodicHistoryEvent,
	type MediaEpisodicRow,
	mediaEpisodicRowLabel,
	type MediaEpisodicSummary,
	type MediaEpisodicView,
} from "./episodic-activity-state";
import { MediaEpisodicCoverageStrip } from "./episodic-coverage";
import {
	type MediaCreditCopy,
	MediaOverviewRelations,
	type MediaOverviewRelationsRender,
} from "./overview";
import {
	mediaOverviewManagedAssets,
	type MediaOverviewState,
	mediaRelationsAreEmpty,
	mediaUnlinkedCreators,
	mediaUnlinkedCredits,
} from "./overview-state";
import {
	mediaEpisodicAiredFact,
	mediaEpisodicLifecycleLabel,
	mediaReleaseLabel,
	type MediaSummaryFact,
	mediaSummaryHeaderDetail,
	type MediaSummaryState,
	mediaSummaryStateMapper,
	type MediaSummaryValue,
} from "./summary-state";

const PEOPLE_LIMIT = 12;
const COMPANY_LIMIT = 6;
const RECOMMENDATION_LIMIT = 12;
const ACTIVITY_COVERAGE_LIMIT = 100;
const ACTIVITY_WATCH_DAY_LIMIT = 1000;
const ACTIVITY_PARENT_EVENT_LIMIT = 60;
const ACTIVITY_EPISODE_EVENT_LIMIT = 100;
const ACTIVITY_COLLECTION_EVENT_LIMIT = 60;
const ACTIVITY_EPISODE_PROGRESS_LIMIT = 100;

type EpisodicCounts = {
	readonly airedEpisodes: number;
	readonly watchedEpisodes: number;
	readonly upcomingEpisodes: number;
	readonly inProgressEpisodes: number;
};

export type MediaEpisodicSummaryValue = MediaSummaryValue &
	EpisodicCounts & {
		readonly state: EpisodicLifecycleState;
		readonly totalEpisodes: number | null;
		readonly nextUp: { readonly id: string } | null;
		readonly collections: { readonly items: readonly { readonly id: string }[] };
	};

export type MediaEpisodicPresentationValue = MediaSavedViewPresentationSubject &
	EpisodicCounts & {
		readonly state: EpisodicLifecycleState;
		readonly publishDate: string | null;
		readonly publishYear: number | null;
	};

type EpisodicSummaryResult<Summary> = {
	readonly summary: Summary | null;
	readonly entitySchemaSlug: string | null;
};

type EpisodicActivityValue<Origin> = MediaEpisodicActivityValue<Origin> & {
	readonly coverage: readonly { readonly id: string }[];
	readonly hasMoreActivities: boolean;
};

export type MediaEpisodicSchemaDescriptor<
	Summary extends MediaEpisodicSummaryValue,
	Overview extends MediaOverviewRows & MediaUnlinkedCreatorsOverview,
	Presentation extends MediaEpisodicPresentationValue,
	Origin,
	Activity extends EpisodicActivityValue<Origin>,
> = {
	readonly recipes: {
		readonly historyRecipe: MediaHistoryRecipe<
			MediaEpisodicHistoryEvent<Origin & MediaEpisodicEpisodeValue>
		>;
		readonly peopleRecipe: MediaCreditsRecipe;
		readonly summaryRecipe: (input: {
			readonly reference: PluginIdentityReference;
			readonly entityId: string;
			readonly collectionLimit: number;
		}) => PreparedRecipe<EpisodicSummaryResult<Summary>>;
		readonly overviewRecipe: (input: EpisodicOverviewInput) => PreparedRecipe<Overview>;
		readonly activityRecipe: (input: EpisodicActivityInput) => PreparedRecipe<Activity>;
		readonly presentationSource: MediaPresentationSource<Presentation>;
	};
	readonly aspect: MediaArtworkAspect;
	readonly logActivity: MediaActivityLogger;
	readonly creditCopy: MediaCreditCopy;
	readonly overviewLoadingDetail: string;
	readonly nouns: { readonly title: string; readonly singular: string; readonly plural: string };
	readonly activityCopy: MediaActivityCopy &
		MediaEpisodicActivityCopy & {
			readonly segmentNoun: string;
			readonly figures: {
				readonly time: string;
				readonly watches: string;
				readonly episodes: string;
			};
		};
	readonly coverage: (result: Activity) => MediaEpisodicCoverage;
	readonly episodeOrigin: (episode: Origin) => string;
	readonly facts: (summary: Summary) => readonly MediaSummaryFact[];
	readonly presentationFacts: (data: Presentation) => readonly string[];
	readonly presentationDetail: (data: Presentation) => string | undefined;
	readonly EpisodesTab: (props: {
		readonly compact: boolean;
		readonly logger: MediaActivityLogger;
		readonly entityId: string;
		readonly safeAreaTop: number;
		readonly summary: Summary | undefined;
	}) => ReactNode;
	readonly overviewTrailing?: (input: {
		readonly summary: Summary;
		readonly compact: boolean;
	}) => ReactNode;
};

const MARKER_TONE: Record<MediaEpisodicRow["type"], string> = {
	beat: "bg-border",
	watch: "bg-success",
	review: "bg-accent",
	progress: "bg-accent",
	completion: "bg-accent",
	"media-library": "bg-accent",
	collection: "bg-transparent",
};

const TABS: readonly TabOption<"overview" | "episodes" | "activity">[] = [
	{ value: "overview", label: "Overview" },
	{ value: "episodes", label: "Episodes" },
	{ value: "activity", label: "Activity" },
];

const lifecycleLabel = (media: { readonly state: EpisodicLifecycleState }) =>
	mediaEpisodicLifecycleLabel(media.state);

const overviewIsEmpty = (overview: MediaOverviewRows & MediaUnlinkedCreatorsOverview) =>
	mediaRelationsAreEmpty(overview, mediaUnlinkedCreators(overview));

export const defineEpisodicMediaSchema = <
	Summary extends MediaEpisodicSummaryValue,
	Overview extends MediaOverviewRows & MediaUnlinkedCreatorsOverview,
	Presentation extends MediaEpisodicPresentationValue,
	Origin,
	Activity extends EpisodicActivityValue<Origin>,
>(
	descriptor: MediaEpisodicSchemaDescriptor<Summary, Overview, Presentation, Origin, Activity>,
) => {
	const { nouns, recipes, activityCopy } = descriptor;

	const summaryQuery = createMediaSummaryQuery(recipes.summaryRecipe, ({ nextUp }) =>
		nextUp === null ? [] : [nextUp.id],
	);
	const peopleQuery = createMediaCreditsQuery(recipes.peopleRecipe);

	const overviewQuery = createMediaEntityQuery(
		(input) =>
			recipes.overviewRecipe({
				entityId: input.entityId,
				peopleLimit: PEOPLE_LIMIT,
				reference: input.reference,
				companyLimit: COMPANY_LIMIT,
				recommendationLimit: RECOMMENDATION_LIMIT,
			}),
		(data) =>
			[...data.people.items, ...data.companies.items, ...data.recommendations.items].map(
				({ id }) => id,
			),
	);

	const activityQuery = createMediaEntityQuery(
		(input) =>
			recipes.activityRecipe({
				entityId: input.entityId,
				reference: input.reference,
				coverageLimit: ACTIVITY_COVERAGE_LIMIT,
				watchDayLimit: ACTIVITY_WATCH_DAY_LIMIT,
				parentEventLimit: ACTIVITY_PARENT_EVENT_LIMIT,
				episodeEventLimit: ACTIVITY_EPISODE_EVENT_LIMIT,
				collectionEventLimit: ACTIVITY_COLLECTION_EVENT_LIMIT,
				episodeProgressLimit: ACTIVITY_EPISODE_PROGRESS_LIMIT,
				timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			}),
		(data) => [
			...data.coverage.map(({ id }) => id),
			...data.watchDays.map(({ episodeId }) => episodeId),
			...data.events.flatMap((event) => {
				if (event.kind === "episode") {
					return [event.episode.id];
				}
				if (event.kind === "collection") {
					return [event.collection.id];
				}
				return [];
			}),
		],
	);

	const summaryState = mediaSummaryStateMapper<EpisodicSummaryResult<Summary>, Summary>({
		...nouns,
		select: ({ summary }) => summary,
	});

	const activityView = (result: Activity) =>
		mediaEpisodicActivityView<Origin>({
			result,
			coverage: descriptor.coverage(result),
			episodeOrigin: descriptor.episodeOrigin,
		});

	const activityRowLabel = (row: MediaEpisodicRow) => mediaEpisodicRowLabel(row, activityCopy);

	const activityRender: MediaActivityRowRender<MediaEpisodicRow> = {
		markerTone: MARKER_TONE,
		rowLabel: activityRowLabel,
		segmentNoun: activityCopy.segmentNoun,
		rowSource: (row) => (row.type === "watch" || row.type === "progress" ? row.source : undefined),
		rowBody: (row) => {
			if (row.type === "watch") {
				return <EpisodicWatchBody row={row} />;
			}
			return row.type === "review" ? <MediaActivityReviewDetail row={row} /> : null;
		},
	};

	const activityFigures = (summary: MediaEpisodicSummary) => {
		const span = mediaActivitySpanLabel(summary.span);
		return [
			{
				detail: undefined,
				label: activityCopy.figures.episodes,
				value: mediaEpisodicEpisodesLabel(summary),
			},
			{ detail: undefined, value: `${summary.watches}`, label: activityCopy.figures.watches },
			{
				detail: undefined,
				label: activityCopy.figures.time,
				value: mediaActivityTimeLabel(summary.minutes),
			},
			{ label: span.label, value: span.value, detail: span.detail },
		];
	};

	function ActivityRecord(props: {
		readonly compact: boolean;
		readonly view: MediaEpisodicView;
		readonly history?: ReactNode;
	}) {
		const { view } = props;
		return (
			<MediaActivityRecord
				history={props.history}
				compact={props.compact}
				render={activityRender}
				timeline={view.timeline}
				recordLabel={activityCopy.recordLabel}
				figures={activityFigures(view.summary)}
				partial={view.summary.span.bound === "partial"}
				aside={<MediaEpisodicCoverageStrip rows={view.coverage} />}
			/>
		);
	}

	const { Activity, ActivityTab, mapActivity } = defineMediaActivityTab({
		view: activityView,
		copy: activityCopy,
		query: activityQuery,
		Record: ActivityRecord,
		emptyAction: descriptor.logActivity,
		hasMoreActivities: (result) => result.hasMoreActivities,
		renderHistory: (events) => (
			<MediaActivityRows
				render={activityRender}
				rows={events.map((event) => mediaEpisodicActivityRow(event, descriptor.episodeOrigin))}
			/>
		),
		historyQuery: createMediaHistoryQuery(recipes.historyRecipe, (events) =>
			events.flatMap((event) => {
				if (event.kind === "episode") {
					return [event.episode.id];
				}
				return event.kind === "collection" ? [event.collection.id] : [];
			}),
		),
	});

	const header = mediaSummaryHeaderDetail({
		logActivity: descriptor.logActivity,
		facts: (summary: Summary) =>
			[...descriptor.facts(summary), mediaEpisodicAiredFact(summary)].filter(
				(fact) => fact !== undefined,
			),
	});

	const overviewRelations: MediaOverviewRelationsRender<Overview> = ({
		compact,
		entityId,
		overview,
		safeAreaTop,
	}) => (
		<MediaOverviewRelations
			compact={compact}
			overview={overview}
			aspect={descriptor.aspect}
			copy={descriptor.creditCopy}
			unlinked={mediaUnlinkedCreators(overview)}
			peopleAction={
				<MediaCreditsButton
					aspect="square"
					compact={compact}
					purpose="profile"
					query={peopleQuery}
					input={{ entityId }}
					label="View all people"
					safeAreaTop={safeAreaTop}
					title={descriptor.creditCopy.people}
					unlinked={mediaUnlinkedCredits(mediaUnlinkedCreators(overview)).people}
				/>
			}
		/>
	);

	function ScreenBody(props: {
		readonly compact: boolean;
		readonly safeAreaTop: number;
		readonly refresh: () => void;
		readonly episodes: ReactNode;
		readonly activity: ReactNode;
		readonly refreshOverview: () => void;
		readonly summaryRefreshStatus?: ReactNode;
		readonly overviewRefreshStatus?: ReactNode;
		readonly state: MediaSummaryState<Summary>;
		readonly overview: MediaOverviewState<Overview>;
		readonly settled: EntitySettleReason | undefined;
	}) {
		return (
			<MediaDetailBody
				tabs={TABS}
				header={header}
				state={props.state}
				defaultTab="overview"
				overviewTab="overview"
				compact={props.compact}
				settled={props.settled}
				refresh={props.refresh}
				overview={props.overview}
				loading={summaryState.loading}
				safeAreaTop={props.safeAreaTop}
				overviewIsEmpty={overviewIsEmpty}
				overviewRelations={overviewRelations}
				refreshOverview={props.refreshOverview}
				summaryError={summaryState.summaryError}
				overviewTrailing={descriptor.overviewTrailing}
				summaryRefreshStatus={props.summaryRefreshStatus}
				overviewNoticeTitle={descriptor.creditCopy.notice}
				overviewRefreshStatus={props.overviewRefreshStatus}
				summaryUnavailable={summaryState.summaryUnavailable}
				overviewLoadingDetail={descriptor.overviewLoadingDetail}
				artwork={{ purpose: "cover", aspect: descriptor.aspect }}
				tabContent={{ episodes: props.episodes, activity: props.activity }}
			/>
		);
	}

	const DetailBody = (input: MediaDetailBodyInput<Summary, Overview>) => (
		<ScreenBody
			{...input}
			activity={createElement(ActivityTab, {
				compact: input.compact,
				entityId: input.entityId,
				safeAreaTop: input.safeAreaTop,
			})}
			episodes={createElement(descriptor.EpisodesTab, {
				compact: input.compact,
				entityId: input.entityId,
				logger: descriptor.logActivity,
				safeAreaTop: input.safeAreaTop,
				summary: input.state.status === "ready" ? input.state.summary : undefined,
			})}
		/>
	);

	function Screen(props: EntityRendererProps) {
		return (
			<MediaDetailScreen
				Body={DetailBody}
				entityId={props.entityId}
				summaryQuery={summaryQuery}
				overviewQuery={overviewQuery}
				mapSummary={summaryState.mapSummary}
				overviewAssets={mediaOverviewManagedAssets}
			/>
		);
	}

	function Facts(props: { readonly compact: boolean; readonly data: Presentation }) {
		const { data } = props;
		const release = mediaReleaseLabel(data);
		const detail = descriptor.presentationDetail(data);
		return (
			<div className={clsx("flex min-w-0 flex-col", props.compact ? "gap-1" : "gap-1.5")}>
				<div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-ui text-[12px] text-text-muted">
					{release === undefined ? null : <span>{release}</span>}
					{descriptor.presentationFacts(data).map((fact) => (
						<span key={fact}>{fact}</span>
					))}
					<span className="font-medium text-accent-text">{lifecycleLabel(data)}</span>
				</div>
				{detail === undefined ? null : (
					<p className="font-ui text-[12px] leading-5 text-text-subtle">{detail}</p>
				)}
			</div>
		);
	}

	function CardContent(props: {
		readonly compact: boolean;
		readonly entityId: string;
		readonly data: MediaPresentationViewData<Presentation>;
	}) {
		return (
			<MediaCardContent
				data={props.data}
				compact={props.compact}
				entityId={props.entityId}
				aspect={descriptor.aspect}
				facts={<Facts data={props.data} compact={props.compact} />}
			/>
		);
	}

	function RowContent(props: {
		readonly compact: boolean;
		readonly entityId: string;
		readonly data: MediaPresentationViewData<Presentation>;
	}) {
		return (
			<MediaRowContent
				data={props.data}
				compact={props.compact}
				entityId={props.entityId}
				aspect={descriptor.aspect}
				facts={<Facts data={props.data} compact={props.compact} />}
			/>
		);
	}

	const presentations = defineMediaPresentationPair({
		Facts,
		aspect: descriptor.aspect,
		source: recipes.presentationSource,
	});

	return {
		Screen,
		Activity,
		ScreenBody,
		RowContent,
		mapActivity,
		ActivityTab,
		CardContent,
		summaryQuery,
		activityView,
		overviewQuery,
		activityQuery,
		lifecycleLabel,
		overviewIsEmpty,
		activityRowLabel,
		overviewRelations,
		page: mediaDetailPage(Screen),
		mapSummary: summaryState.mapSummary,
		summaryError: summaryState.summaryError,
		rowPresentation: presentations.rowPresentation,
		cardPresentation: presentations.cardPresentation,
		summaryUnavailable: summaryState.summaryUnavailable,
	};
};

function EpisodicWatchBody(props: { readonly row: Extract<MediaEpisodicRow, { type: "watch" }> }) {
	if (props.row.episodes.length === 1) {
		return null;
	}
	return (
		<div className="flex flex-col gap-0.5">
			{props.row.episodes.map((episode) => (
				<div key={episode.id} className="flex gap-2">
					<p className="w-14 font-ui text-[12px] text-text-subtle">{episode.origin}</p>
					<p className="line-clamp-1 min-w-0 flex-1 font-ui text-[12px] text-text-muted">
						{episode.name}
					</p>
				</div>
			))}
		</div>
	);
}
