import type { EntitySettleReason } from "@ryot-app/client-sdk";
import type { EntityRendererProps } from "@ryot-app/client-sdk/plugin";
import { createRyotQuery, useRyotQuery, type RyotQueryResult } from "@ryot-app/client-sdk/react";
import type { PreparedRecipe } from "@ryot-app/client-sdk/ryotql";
import clsx from "clsx";
import { createElement, type ReactNode } from "react";

import type { EpisodicActivityInput, EpisodicOverviewInput } from "../../shared/episodic-recipes";
import type { EpisodicLifecycleState } from "../../shared/lifecycle-expressions";
import type { MediaOverviewRows, MediaUnlinkedCreatorsOverview } from "../../shared/media-recipes";
import { MediaActivityReviewDetail, type MediaActivityRowRender } from "./activity-rows";
import {
	MediaActivity,
	MediaActivityRecord,
	type MediaActivityCopy,
	type MediaActivityState,
} from "./activity-tab";
import { mediaActivitySpanLabel, mediaActivityTimeLabel } from "./activity-timeline";
import {
	MediaDetailBody,
	MediaDetailScreen,
	mediaDetailPage,
	type MediaDetailBodyInput,
} from "./detail-screen";
import {
	createMediaPresentationLoader,
	defineMediaPresentationPair,
	MediaCardContent,
	MediaRowContent,
	type MediaArtworkAspect,
	type MediaPresentationSubject,
	type MediaPresentationViewData,
} from "./entity-presentation";
import {
	mapMediaEpisodicActivity,
	mediaEpisodicActivityView,
	mediaEpisodicEpisodesLabel,
	mediaEpisodicRowLabel,
	type MediaEpisodicActivityCopy,
	type MediaEpisodicActivityValue,
	type MediaEpisodicCoverage,
	type MediaEpisodicRow,
	type MediaEpisodicSummary,
	type MediaEpisodicView,
} from "./episodic-activity-state";
import { MediaEpisodicCoverageStrip } from "./episodic-coverage";
import {
	MediaOverviewRelations,
	type MediaCreditCopy,
	type MediaOverviewRelationsRender,
} from "./overview";
import {
	mediaOverviewManagedAssets,
	mediaRelationsAreEmpty,
	mediaUnlinkedCreators,
	type MediaOverviewState,
} from "./overview-state";
import { MediaRefreshStatus } from "./primitives";
import type { MediaSummaryValue } from "./summary-header";
import {
	mediaEpisodicLifecycleLabel,
	mediaReleaseLabel,
	mediaSummaryStateMapper,
	type MediaSummaryFact,
	type MediaSummaryState,
} from "./summary-state";
import type { MediaTab } from "./tabs";

const PEOPLE_LIMIT = 12;
const COMPANY_LIMIT = 6;
const RECOMMENDATION_LIMIT = 12;
const SUMMARY_COLLECTION_LIMIT = 6;
const ACTIVITY_COVERAGE_LIMIT = 100;
const ACTIVITY_WATCH_DAY_LIMIT = 1000;
const ACTIVITY_PARENT_EVENT_LIMIT = 60;
const ACTIVITY_EPISODE_EVENT_LIMIT = 100;
const ACTIVITY_COLLECTION_EVENT_LIMIT = 60;
const ACTIVITY_EPISODE_PROGRESS_LIMIT = 100;

type EntityInput = { readonly entityId: string };

type EpisodicCounts = {
	readonly storedEpisodes: number;
	readonly watchedEpisodes: number;
	readonly inProgressEpisodes: number;
};

export type MediaEpisodicSummaryValue = MediaSummaryValue &
	EpisodicCounts & {
		readonly state: EpisodicLifecycleState;
		readonly totalEpisodes: number | null;
		readonly collections: { readonly items: readonly { readonly id: string }[] };
	};

export type MediaEpisodicPresentationValue = MediaPresentationSubject &
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
};

export type MediaEpisodicSchemaDescriptor<
	Summary extends MediaEpisodicSummaryValue,
	Overview extends MediaOverviewRows & MediaUnlinkedCreatorsOverview,
	Presentation extends MediaEpisodicPresentationValue,
	Origin,
	Activity extends EpisodicActivityValue<Origin>,
> = {
	readonly recipes: {
		readonly summaryRecipe: (input: {
			readonly entityId: string;
			readonly collectionLimit: number;
		}) => PreparedRecipe<EpisodicSummaryResult<Summary>>;
		readonly overviewRecipe: (input: EpisodicOverviewInput) => PreparedRecipe<Overview>;
		readonly activityRecipe: (input: EpisodicActivityInput) => PreparedRecipe<Activity>;
		readonly presentationRecipe: (
			entityIds: readonly string[],
		) => PreparedRecipe<readonly Presentation[]>;
	};
	readonly typeLabel: string;
	readonly aspect: MediaArtworkAspect;
	readonly creditCopy: MediaCreditCopy;
	readonly overviewLoadingDetail: string;
	readonly heroHeight: (compact: boolean) => number;
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
		readonly entityId: string;
		readonly summary: Summary | undefined;
	}) => ReactNode;
	readonly overviewTrailing?: (input: {
		readonly summary: Summary;
		readonly compact: boolean;
		readonly divided: boolean;
	}) => ReactNode;
};

const MARKER_TONE: Record<MediaEpisodicRow["type"], string> = {
	beat: "bg-border",
	watch: "bg-success",
	review: "bg-accent",
	progress: "bg-accent",
	completion: "bg-accent",
	collection: "bg-transparent",
};

const TABS: readonly MediaTab<"overview" | "episodes" | "activity">[] = [
	{ key: "overview", label: "Overview" },
	{ key: "episodes", label: "Episodes" },
	{ key: "activity", label: "Activity" },
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

	const summaryQuery = createRyotQuery<EntityInput, EpisodicSummaryResult<Summary>>(
		({ input, client, signal }) =>
			client.data.query(
				recipes.summaryRecipe({ ...input, collectionLimit: SUMMARY_COLLECTION_LIMIT }),
				{ signal },
			),
		{
			entityInterest: ({ data, input }) => ({
				foreground: [input.entityId],
				visible: data?.summary?.collections.items.map(({ id }) => id) ?? [],
			}),
		},
	);

	const overviewQuery = createRyotQuery<EntityInput, Overview>(
		({ input, client, signal }) =>
			client.data.query(
				recipes.overviewRecipe({
					entityId: input.entityId,
					peopleLimit: PEOPLE_LIMIT,
					companyLimit: COMPANY_LIMIT,
					recommendationLimit: RECOMMENDATION_LIMIT,
				}),
				{ signal },
			),
		{
			entityInterest: ({ data, input }) => ({
				foreground: [input.entityId],
				visible: data
					? [...data.people.items, ...data.companies.items, ...data.recommendations.items].map(
							({ id }) => id,
						)
					: [],
			}),
		},
	);

	const activityQuery = createRyotQuery<EntityInput, Activity>(
		({ input, client, signal }) =>
			client.data.query(
				recipes.activityRecipe({
					entityId: input.entityId,
					coverageLimit: ACTIVITY_COVERAGE_LIMIT,
					watchDayLimit: ACTIVITY_WATCH_DAY_LIMIT,
					parentEventLimit: ACTIVITY_PARENT_EVENT_LIMIT,
					episodeEventLimit: ACTIVITY_EPISODE_EVENT_LIMIT,
					collectionEventLimit: ACTIVITY_COLLECTION_EVENT_LIMIT,
					episodeProgressLimit: ACTIVITY_EPISODE_PROGRESS_LIMIT,
					timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				}),
				{ signal },
			),
		{
			entityInterest: ({ data, input }) => ({
				foreground: [input.entityId],
				visible: data
					? [
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
						]
					: [],
			}),
		},
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

	const mapActivity = (result: RyotQueryResult<Activity>) =>
		mapMediaEpisodicActivity(result, activityView);

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

	function ActivityRecord(props: { readonly compact: boolean; readonly view: MediaEpisodicView }) {
		const { view } = props;
		return (
			<MediaActivityRecord
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

	function Activity(props: {
		readonly compact: boolean;
		readonly refresh: () => void;
		readonly state: MediaActivityState<MediaEpisodicView>;
	}) {
		return (
			<MediaActivity
				copy={activityCopy}
				state={props.state}
				Record={ActivityRecord}
				compact={props.compact}
				refresh={props.refresh}
			/>
		);
	}

	function ActivityTab(props: { readonly compact: boolean; readonly entityId: string }) {
		const result = useRyotQuery(activityQuery, { entityId: props.entityId });
		return (
			<>
				<MediaRefreshStatus result={result} />
				<Activity compact={props.compact} refresh={result.refetch} state={mapActivity(result)} />
			</>
		);
	}

	const overviewRelations: MediaOverviewRelationsRender<Overview> = ({
		compact,
		divided,
		overview,
	}) => (
		<MediaOverviewRelations
			compact={compact}
			divided={divided}
			overview={overview}
			copy={descriptor.creditCopy}
			unlinked={mediaUnlinkedCreators(overview)}
			onViewAllPeople={() => console.log(`TODO: open all ${nouns.singular} credits`)}
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
				state={props.state}
				overviewTab="overview"
				compact={props.compact}
				settled={props.settled}
				refresh={props.refresh}
				facts={descriptor.facts}
				overview={props.overview}
				lifecycleLabel={lifecycleLabel}
				safeAreaTop={props.safeAreaTop}
				typeLabel={descriptor.typeLabel}
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
				tabContent={{ episodes: props.episodes, activity: props.activity }}
				loading={{
					title: `Loading ${nouns.singular}...`,
					detail: `Fetching the latest details for this ${nouns.singular}.`,
				}}
			/>
		);
	}

	const DetailBody = (input: MediaDetailBodyInput<Summary, Overview>) => (
		<ScreenBody
			{...input}
			activity={createElement(ActivityTab, { compact: input.compact, entityId: input.entityId })}
			episodes={createElement(descriptor.EpisodesTab, {
				compact: input.compact,
				entityId: input.entityId,
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
				heroHeight={descriptor.heroHeight}
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
		loader: createMediaPresentationLoader(recipes.presentationRecipe),
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
