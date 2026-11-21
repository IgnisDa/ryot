import type { EntitySettleReason, LocalMessage } from "@ryot-app/plugin-client-sdk";
import type { EntityRendererProps } from "@ryot-app/plugin-client-sdk/plugin";
import type { SelectedRowsSource } from "@ryot-app/plugin-client-sdk/ryotql";
import type { TabOption } from "@ryot-app/plugin-ui-sdk";
import clsx from "clsx";
import { createElement, type ReactNode } from "react";

import type { EpisodicLifecycleState } from "../../shared/lifecycle-expressions";
import type { MediaOverviewRows, MediaUnlinkedCreatorsOverview } from "../../shared/media-recipes";
import { type MediaCopy, type MediaText, useMediaCopy, useMediaMessages } from "../messages";
import {
	mediaActivityExpandLabel,
	mediaActivityRunLabel,
	type MediaActivitySegment,
} from "./activity-copy";
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
import { mergeActivityRuns } from "./activity-timeline";
import { createMediaCreditsQuery, MediaCreditsButton, type MediaCreditsRecipe } from "./credits";
import type { MediaEntityRecipe } from "./detail-queries";
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
	mediaEpisodicActivityFigures,
	mediaEpisodicActivityRow,
	type MediaEpisodicActivityValue,
	mediaEpisodicActivityView,
	type MediaEpisodicCoverage,
	mediaEpisodicEpisodesAreCollapsed,
	type MediaEpisodicEpisodeValue,
	type MediaEpisodicFigureLabels,
	type MediaEpisodicHistoryEvent,
	mediaEpisodicMonthSummary,
	mediaEpisodicRangeSummary,
	type MediaEpisodicRow,
	mediaEpisodicRowLabel,
	type MediaEpisodicView,
	type MediaEpisodicWatchedEpisode,
	mergeEpisodicRuns,
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

export type MediaEpisodicPresentationValue = EpisodicCounts &
	MediaSavedViewPresentationSubject & {
		readonly publishDate: null | string;
		readonly publishYear: null | number;
		readonly state: EpisodicLifecycleState;
	};

export type MediaEpisodicSummaryValue = EpisodicCounts &
	MediaSummaryValue & {
		readonly ownedEpisodes: number;
		readonly totalEpisodes: null | number;
		readonly state: EpisodicLifecycleState;
		readonly nextUp: null | { readonly id: string };
		readonly collections: { readonly items: readonly { readonly id: string }[] };
	};

export type MediaEpisodicSchemaDescriptor<
	Summary extends MediaEpisodicSummaryValue,
	Overview extends MediaOverviewRows & MediaUnlinkedCreatorsOverview,
	Presentation extends MediaEpisodicPresentationValue,
	Origin,
	Activity extends EpisodicActivityValue<Origin>,
> = {
	readonly aspect: MediaArtworkAspect;
	readonly creditCopy: MediaCreditCopy;
	readonly logActivity: MediaActivityLogger;
	readonly overviewLoadingDetail: LocalMessage;
	readonly episodeOrigin: (episode: Origin) => LocalMessage;
	readonly episodeOrder: (episode: Origin) => readonly number[];
	readonly coverage: (result: Activity) => MediaEpisodicCoverage;
	readonly presentationFacts: (data: Presentation) => readonly string[];
	readonly facts: (summary: Summary, copy: MediaCopy) => readonly MediaSummaryFact[];
	readonly presentationDetail: (data: Presentation, copy: MediaCopy) => string | undefined;
	readonly overviewTrailing?: (input: {
		readonly summary: Summary;
		readonly compact: boolean;
	}) => ReactNode;
	readonly activityCopy: (
		copy: MediaCopy,
	) => MediaActivityCopy &
		MediaEpisodicActivityCopy & {
			readonly segment: MediaActivitySegment;
			readonly figures: MediaEpisodicFigureLabels;
		};
	readonly EpisodesTab: (props: {
		readonly compact: boolean;
		readonly entityId: string;
		readonly safeAreaTop: number;
		readonly logger: MediaActivityLogger;
		readonly summary: Summary | undefined;
	}) => ReactNode;
	readonly recipes: {
		readonly peopleRecipe: MediaCreditsRecipe;
		readonly companiesRecipe: MediaCreditsRecipe;
		readonly overviewRecipe: MediaEntityRecipe<Overview>;
		readonly activityRecipe: MediaEntityRecipe<Activity>;
		readonly presentationSource: SelectedRowsSource<Presentation>;
		readonly summaryRecipe: MediaEntityRecipe<EpisodicSummaryResult<Summary>>;
		readonly historyRecipe: MediaHistoryRecipe<
			MediaEpisodicHistoryEvent<Origin & MediaEpisodicEpisodeValue>
		>;
	};
};

type EpisodicSummaryResult<Summary> = {
	readonly summary: null | Summary;
	readonly entitySchemaSlug: null | string;
};

type EpisodicCounts = {
	readonly airedEpisodes: number;
	readonly watchedEpisodes: number;
	readonly upcomingEpisodes: number;
	readonly inProgressEpisodes: number;
};

type EpisodicActivityValue<Origin> = MediaEpisodicActivityValue<Origin> & {
	readonly hasMoreActivities: boolean;
	readonly coverage: readonly { readonly id: string }[];
};

const tabs = (text: MediaText): readonly TabOption<"overview" | "episodes" | "activity">[] => [
	{ value: "overview", label: text("tabs.overview") },
	{ value: "episodes", label: text("property.episodes") },
	{ value: "activity", label: text("browse.field.activity") },
];

const lifecycleLabel = (text: MediaText, media: { readonly state: EpisodicLifecycleState }) =>
	mediaEpisodicLifecycleLabel(text, media.state);

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
	const { recipes } = descriptor;

	const summaryQuery = createMediaSummaryQuery(recipes.summaryRecipe, ({ nextUp }) =>
		nextUp === null ? [] : [nextUp.id],
	);
	const peopleQuery = createMediaCreditsQuery(
		recipes.peopleRecipe,
		({ entityId }) => ({ entityId }),
		"people",
	);
	const companiesQuery = createMediaCreditsQuery(
		recipes.companiesRecipe,
		({ entityId }) => ({ entityId }),
		"companies",
	);
	const overviewQuery = createMediaEntityQuery(
		(input) => recipes.overviewRecipe({ reference: input.reference }),
		(data) =>
			[...data.people.items, ...data.companies.items, ...data.recommendations.items].map(
				({ id }) => id,
			),
	);

	const activityQuery = createMediaEntityQuery(
		(input) => recipes.activityRecipe({ reference: input.reference }),
		(data) => [
			...data.coverage.map(({ id }) => id),
			...data.watchDays.map(({ episodeId }) => episodeId),
			...data.events.flatMap((event) => {
				if (event.kind === "episode") {
					return [event.episode.id];
				}
				if (event.kind === "season") {
					return [event.season.id];
				}
				if (event.kind === "collection") {
					return [event.collection.id];
				}
				return [];
			}),
		],
	);

	const summaryState = mediaSummaryStateMapper<EpisodicSummaryResult<Summary>, Summary>(
		({ summary }) => summary,
	);

	const activityView = (result: Activity) =>
		mediaEpisodicActivityView<Origin>({
			result,
			coverage: descriptor.coverage(result),
			episode: { order: descriptor.episodeOrder, origin: descriptor.episodeOrigin },
		});

	const activityRowLabel = (copy: MediaCopy, row: MediaEpisodicRow) =>
		mediaEpisodicRowLabel(copy, row, descriptor.activityCopy(copy));

	const activityRender = (copy: MediaCopy): MediaActivityRowRender<MediaEpisodicRow> => ({
		rowLabel: (row) => activityRowLabel(copy, row),
		segment: descriptor.activityCopy(copy).segment,
		monthSummary: (rows) => mediaEpisodicMonthSummary(copy.text, rows),
		rowSource: (row) => (row.type === "watch" || row.type === "progress" ? row.source : undefined),
		rowRun: (row) =>
			(row.type === "progress" || row.type === "watch") && row.run !== undefined
				? mediaActivityRunLabel(copy, row.run)
				: undefined,
		rowBody: (row) => {
			if (row.type === "watch") {
				return <EpisodicWatchBody row={row} />;
			}
			return row.type === "review" ? <MediaActivityReviewDetail row={row} /> : null;
		},
		rowExpand: (row) =>
			row.type === "watch" && mediaEpisodicEpisodesAreCollapsed(row.episodes)
				? {
						content: <EpisodicEpisodeList episodes={row.episodes} />,
						label: (expanded) =>
							mediaActivityExpandLabel(copy.text, { expanded, count: row.episodes.length }),
					}
				: undefined,
	});

	function ActivityRecord(props: {
		readonly compact: boolean;
		readonly history?: ReactNode;
		readonly view: MediaEpisodicView;
	}) {
		const { view } = props;
		const copy = useMediaCopy();
		const activityCopy = descriptor.activityCopy(copy);
		return (
			<MediaActivityRecord
				history={props.history}
				compact={props.compact}
				timeline={view.timeline}
				render={activityRender(copy)}
				recordLabel={activityCopy.recordLabel}
				partial={view.summary.span.bound === "partial"}
				aside={<MediaEpisodicCoverageStrip rows={view.coverage} />}
				figures={mediaEpisodicActivityFigures(copy, view.summary, activityCopy.figures)}
			/>
		);
	}

	function ActivityHistoryRows(props: {
		readonly compact: boolean;
		readonly events: readonly MediaEpisodicHistoryEvent<Origin & MediaEpisodicEpisodeValue>[];
	}) {
		const copy = useMediaCopy();
		return (
			<MediaActivityRows
				compact={props.compact}
				render={activityRender(copy)}
				rows={mergeActivityRuns(
					props.events.map((event) =>
						mediaEpisodicActivityRow(event, {
							order: descriptor.episodeOrder,
							origin: descriptor.episodeOrigin,
						}),
					),
					mergeEpisodicRuns,
				)}
			/>
		);
	}

	const { Activity, ActivityTab, mapActivity } = defineMediaActivityTab({
		view: activityView,
		query: activityQuery,
		Record: ActivityRecord,
		copy: descriptor.activityCopy,
		emptyAction: descriptor.logActivity,
		hasMoreActivities: (result) => result.hasMoreActivities,
		renderHistory: (events, compact) => <ActivityHistoryRows events={events} compact={compact} />,
		historyQuery: createMediaHistoryQuery(recipes.historyRecipe, (events) =>
			events.flatMap((event) => {
				if (event.kind === "episode") {
					return [event.episode.id];
				}
				if (event.kind === "season") {
					return [event.season.id];
				}
				return event.kind === "collection" ? [event.collection.id] : [];
			}),
		),
	});

	const header = (summary: Summary, copy: MediaCopy) =>
		mediaSummaryHeaderDetail({
			logActivity: descriptor.logActivity,
			facts: (value: Summary) =>
				[
					...descriptor.facts(value, copy),
					mediaEpisodicAiredFact(copy.text, value),
					value.ownedEpisodes === 0
						? undefined
						: {
								icon: "box" as const,
								label: copy.text("ownership.episodes-with-copies"),
								value: copy.formatters.number().format(value.ownedEpisodes),
							},
				].filter((fact) => fact !== undefined),
		})(summary, copy);

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
					kind="people"
					aspect="square"
					compact={compact}
					purpose="profile"
					query={peopleQuery}
					input={{ entityId }}
					safeAreaTop={safeAreaTop}
					title={descriptor.creditCopy.people}
					unlinked={mediaUnlinkedCredits(mediaUnlinkedCreators(overview)).people}
				/>
			}
			companiesAction={
				<MediaCreditsButton
					fit="contain"
					purpose="logo"
					aspect="square"
					kind="companies"
					compact={compact}
					input={{ entityId }}
					query={companiesQuery}
					safeAreaTop={safeAreaTop}
					title={descriptor.creditCopy.companies}
					unlinked={mediaUnlinkedCredits(mediaUnlinkedCreators(overview)).companies}
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
		readonly settled: undefined | EntitySettleReason;
	}) {
		const text = useMediaMessages();
		return (
			<MediaDetailBody
				header={header}
				tabs={tabs(text)}
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
		const copy = useMediaCopy();
		const { text } = copy;
		const release = mediaReleaseLabel(data);
		const detail = descriptor.presentationDetail(data, copy);
		return (
			<div className={clsx("flex min-w-0 flex-col", props.compact ? "gap-1" : "gap-1.5")}>
				<div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-ui text-[12px] text-text-muted">
					{release === undefined ? null : <span>{release}</span>}
					{descriptor.presentationFacts(data).map((fact) => (
						<span key={fact}>{fact}</span>
					))}
					<span className="font-medium text-accent-text">{lifecycleLabel(text, data)}</span>
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
	const { episodes } = props.row;
	const copy = useMediaCopy();
	if (episodes.length === 1) {
		return null;
	}
	if (mediaEpisodicEpisodesAreCollapsed(episodes)) {
		return (
			<p className="text-label text-text-muted">{mediaEpisodicRangeSummary(copy, episodes)}</p>
		);
	}
	return <EpisodicEpisodeList episodes={episodes} />;
}

function EpisodicEpisodeList(props: { readonly episodes: readonly MediaEpisodicWatchedEpisode[] }) {
	const { local } = useMediaCopy();
	return (
		<div className="flex flex-col gap-0.5">
			{props.episodes.map((episode) => (
				<div key={episode.id} className="flex gap-2">
					<p className="w-14 text-micro text-text-subtle">{local(episode.origin)}</p>
					<p className="line-clamp-1 min-w-0 flex-1 text-label text-text-muted">{episode.name}</p>
				</div>
			))}
		</div>
	);
}
