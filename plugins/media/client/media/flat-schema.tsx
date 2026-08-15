import type { EntitySettleReason } from "@ryot-app/client-sdk";
import type { EntityRendererProps } from "@ryot-app/client-sdk/plugin";
import { createRyotQuery, useRyotQuery, type RyotQueryResult } from "@ryot-app/client-sdk/react";
import type { PreparedRecipe } from "@ryot-app/client-sdk/ryotql";
import clsx from "clsx";
import { createElement, type ReactNode } from "react";

import type { MediaLifecycleState } from "../../shared/lifecycle-expressions";
import type {
	MediaFlatActivityEvent,
	MediaUnlinkedCreatorsOverview,
} from "../../shared/media-recipes";
import { MediaActivityReviewDetail, type MediaActivityRowRender } from "./activity-rows";
import { MediaActivity, MediaActivityRecord, type MediaActivityState } from "./activity-tab";
import { decimalLabel, mediaActivitySpanLabel } from "./activity-timeline";
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
	mediaFlatActivityView,
	type MediaFlatActivityBeat,
	type MediaFlatActivityRow,
	type MediaFlatActivitySummary,
	type MediaFlatActivityView,
} from "./flat-activity-state";
import {
	mediaGroupOverviewIsEmpty,
	mediaGroupOverviewManagedAssets,
	MediaPartOfSection,
	type MediaGroupOverview,
} from "./group-section";
import type { MediaImagePurposes } from "./image";
import {
	MediaOverviewRelations,
	type MediaCreditCopy,
	type MediaOverviewRelationsRender,
} from "./overview";
import {
	mediaRelationsAreEmpty,
	mediaUnlinkedCreators,
	type MediaOverviewState,
} from "./overview-state";
import { MediaRefreshStatus } from "./primitives";
import { classifyRyotQueryResult } from "./query-state";
import type { MediaSummaryValue } from "./summary-header";
import {
	mediaFlatLifecycleLabel,
	mediaReleaseLabel,
	mediaSummaryStateMapper,
	type MediaSummaryFact,
	type MediaSummaryState,
} from "./summary-state";
import type { MediaTab } from "./tabs";

const GROUP_LIMIT = 20;
const PEOPLE_LIMIT = 12;
const COMPANY_LIMIT = 6;
const RECOMMENDATION_LIMIT = 12;
const SUMMARY_COLLECTION_LIMIT = 6;
const ACTIVITY_EVENT_LIMIT = 60;
const ACTIVITY_COLLECTION_EVENT_LIMIT = 60;

type FlatReviewSubject = { readonly on: "media" };

const REVIEW_SUBJECT: FlatReviewSubject = { on: "media" };

export type MediaFlatSchemaRow<Extra = unknown> = MediaFlatActivityRow<FlatReviewSubject, Extra>;

export type MediaFlatSchemaActivityView<Extra = unknown> = MediaFlatActivityView<
	FlatReviewSubject,
	Extra
>;

type FlatSummary = MediaSummaryValue & {
	readonly state: MediaLifecycleState;
	readonly progressPercent: number | null;
	readonly collections: { readonly items: readonly { readonly id: string }[] };
};

type FlatPresentation = MediaPresentationSubject & {
	readonly state: MediaLifecycleState;
	readonly publishDate: string | null;
	readonly publishYear: number | null;
	readonly progressPercent: number | null;
};

type FlatSummaryResult<Summary> = {
	readonly summary: Summary | null;
	readonly entitySchemaSlug: string | null;
};

export type MediaFlatActivityResult<Extra = unknown> = {
	readonly truncated: boolean;
	readonly completionCount: number;
	readonly unknownAmountCount: number;
	readonly consumedAmount: number | null;
	readonly events: readonly MediaFlatActivityEvent<Extra>[];
};

type EntityInput = { readonly entityId: string };

export type MediaFlatSchemaDescriptor<
	Summary extends FlatSummary,
	Overview extends MediaGroupOverview & MediaUnlinkedCreatorsOverview,
	Presentation extends FlatPresentation,
	Extra = unknown,
> = {
	readonly recipes: {
		readonly summaryRecipe: (input: {
			readonly entityId: string;
			readonly collectionLimit: number;
		}) => PreparedRecipe<FlatSummaryResult<Summary>>;
		readonly overviewRecipe: (input: {
			readonly entityId: string;
			readonly groupLimit: number;
			readonly peopleLimit: number;
			readonly companyLimit: number;
			readonly recommendationLimit: number;
		}) => PreparedRecipe<Overview>;
		readonly activityRecipe: (input: {
			readonly entityId: string;
			readonly eventLimit: number;
			readonly collectionEventLimit: number;
		}) => PreparedRecipe<MediaFlatActivityResult<NoInfer<Extra>>>;
		readonly presentationRecipe: (
			entityIds: readonly string[],
		) => PreparedRecipe<readonly Presentation[]>;
	};
	readonly aspect: MediaArtworkAspect;
	readonly heroHeight: (compact: boolean) => number;
	readonly backdropPurposes?: MediaImagePurposes;
	readonly nouns: { readonly title: string; readonly singular: string; readonly plural: string };
	readonly activityCopy: {
		readonly recordLabel: string;
		readonly segmentNoun: string;
		readonly emptyDetail: string;
		readonly loadingDetail: string;
		readonly completionsLabel: string;
		readonly rowLabels: {
			readonly review: string;
			readonly completion: string;
			readonly progress: (percent: string | undefined, extra: Extra) => string;
		};
		readonly beats: Record<Exclude<MediaFlatActivityBeat, "backlog">, string>;
	};
	readonly measureFigure: {
		readonly label: string;
		readonly value: (amount: MediaFlatActivitySummary["amount"]) => string;
	};
	readonly creditCopy: MediaCreditCopy;
	readonly overviewLoadingDetail: string;
	readonly group?: { readonly actionLabel: string; readonly title: (name: string) => string };
	readonly progressVerb: string;
	readonly facts: (summary: Summary) => readonly MediaSummaryFact[];
	readonly presentationFacts: (data: Presentation) => readonly string[];
	readonly overviewTrailing?: (input: {
		readonly summary: Summary;
		readonly compact: boolean;
		readonly divided: boolean;
	}) => ReactNode;
};

const MARKER_TONE: Record<MediaFlatSchemaRow["type"], string> = {
	beat: "bg-border",
	review: "bg-accent",
	progress: "bg-accent",
	completion: "bg-accent",
	collection: "bg-transparent",
};

const TABS: readonly MediaTab<"overview" | "activity">[] = [
	{ key: "overview", label: "Overview" },
	{ key: "activity", label: "Activity" },
];

const lifecycleLabel = (media: { readonly state: MediaLifecycleState }) =>
	mediaFlatLifecycleLabel(media.state);

const overviewIsEmpty = (overview: MediaGroupOverview & MediaUnlinkedCreatorsOverview) =>
	mediaGroupOverviewIsEmpty(overview, mediaUnlinkedCreators(overview));

const summaryProgress = (summary: FlatSummary) =>
	summary.state === "in_progress" && summary.progressPercent !== null
		? { percent: summary.progressPercent }
		: undefined;

export const defineFlatMediaSchema = <
	Summary extends FlatSummary,
	Overview extends MediaGroupOverview & MediaUnlinkedCreatorsOverview,
	Presentation extends FlatPresentation,
	Extra = unknown,
>(
	descriptor: MediaFlatSchemaDescriptor<Summary, Overview, Presentation, Extra>,
) => {
	const { nouns, recipes, activityCopy } = descriptor;

	const summaryQuery = createRyotQuery<EntityInput, FlatSummaryResult<Summary>>(
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
					groupLimit: GROUP_LIMIT,
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
					? [
							...data.people.items,
							...data.companies.items,
							...data.recommendations.items,
							...(data.group?.members.items ?? []),
						].map(({ id }) => id)
					: [],
			}),
		},
	);

	const activityQuery = createRyotQuery<EntityInput, MediaFlatActivityResult<Extra>>(
		({ input, client, signal }) =>
			client.data.query(
				recipes.activityRecipe({
					entityId: input.entityId,
					eventLimit: ACTIVITY_EVENT_LIMIT,
					collectionEventLimit: ACTIVITY_COLLECTION_EVENT_LIMIT,
				}),
				{ signal },
			),
		{
			entityInterest: ({ data, input }) => ({
				foreground: [input.entityId],
				visible:
					data?.events.flatMap((event) =>
						event.kind === "collection" ? [event.collection.id] : [],
					) ?? [],
			}),
		},
	);

	const summaryState = mediaSummaryStateMapper<FlatSummaryResult<Summary>, Summary>({
		...nouns,
		select: ({ summary }) => summary,
	});

	const activityView = (result: MediaFlatActivityResult<Extra>) =>
		mediaFlatActivityView({
			events: result.events,
			subject: REVIEW_SUBJECT,
			truncated: result.truncated,
			completions: result.completionCount,
			amount: { total: result.consumedAmount ?? 0, missing: result.unknownAmountCount },
		});

	const mapActivity = (
		result: RyotQueryResult<MediaFlatActivityResult<Extra>>,
	): MediaActivityState<MediaFlatSchemaActivityView<Extra>> => {
		const state = classifyRyotQueryResult(result);
		if (state.status !== "ready") {
			return state;
		}
		const view = activityView(state.value);
		return view === undefined ? { status: "empty" } : { view, status: "ready" };
	};

	const activityRowLabel = (row: MediaFlatSchemaRow<Extra>): string => {
		if (row.type === "completion") {
			return activityCopy.rowLabels.completion;
		}
		if (row.type === "collection") {
			return row.change === "added"
				? `Added to the ${row.name} collection`
				: `Removed from the ${row.name} collection`;
		}
		if (row.type === "beat") {
			return row.beat === "backlog" ? "Added to backlog" : activityCopy.beats[row.beat];
		}
		if (row.type === "progress") {
			return activityCopy.rowLabels.progress(
				row.percent === undefined ? undefined : decimalLabel(row.percent),
				row.extra,
			);
		}
		return activityCopy.rowLabels.review;
	};

	const activityRender: MediaActivityRowRender<MediaFlatSchemaRow<Extra>> = {
		markerTone: MARKER_TONE,
		rowLabel: activityRowLabel,
		segmentNoun: activityCopy.segmentNoun,
		rowSource: (row) => (row.type === "progress" ? row.source : undefined),
		rowBody: (row) => (row.type === "review" ? <MediaActivityReviewDetail row={row} /> : null),
	};

	const activityFigures = (summary: MediaFlatActivitySummary) => {
		const span = mediaActivitySpanLabel(summary.span);
		return [
			{ detail: undefined, value: `${summary.completions}`, label: activityCopy.completionsLabel },
			{
				detail: undefined,
				label: descriptor.measureFigure.label,
				value: descriptor.measureFigure.value(summary.amount),
			},
			{ label: span.label, value: span.value, detail: span.detail },
		];
	};

	function ActivityRecord(props: {
		readonly compact: boolean;
		readonly view: MediaFlatSchemaActivityView<Extra>;
	}) {
		const { view } = props;
		return (
			<MediaActivityRecord
				compact={props.compact}
				render={activityRender}
				timeline={view.timeline}
				recordLabel={activityCopy.recordLabel}
				figures={activityFigures(view.summary)}
				partial={view.summary.span.bound === "partial"}
			/>
		);
	}

	function Activity(props: {
		readonly compact: boolean;
		readonly refresh: () => void;
		readonly state: MediaActivityState<MediaFlatSchemaActivityView<Extra>>;
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
	}) => {
		const groupCopy = descriptor.group;
		const group = groupCopy === undefined ? null : (overview.group ?? null);
		const unlinked = mediaUnlinkedCreators(overview);
		return (
			<MediaOverviewRelations
				compact={compact}
				divided={divided}
				overview={overview}
				unlinked={unlinked}
				copy={descriptor.creditCopy}
				onViewAllPeople={() => console.log(`TODO: open all ${nouns.singular} credits`)}
				trailing={
					group === null || groupCopy === undefined ? null : (
						<MediaPartOfSection
							group={group}
							compact={compact}
							aspect={descriptor.aspect}
							title={groupCopy.title(group.name)}
							actionLabel={groupCopy.actionLabel}
							divided={divided || !mediaRelationsAreEmpty(overview, unlinked)}
						/>
					)
				}
			/>
		);
	};

	function ScreenBody(props: {
		readonly compact: boolean;
		readonly safeAreaTop: number;
		readonly refresh: () => void;
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
				typeLabel={nouns.title}
				facts={descriptor.facts}
				overview={props.overview}
				progress={summaryProgress}
				lifecycleLabel={lifecycleLabel}
				safeAreaTop={props.safeAreaTop}
				overviewIsEmpty={overviewIsEmpty}
				overviewRelations={overviewRelations}
				refreshOverview={props.refreshOverview}
				summaryError={summaryState.summaryError}
				tabContent={{ activity: props.activity }}
				overviewTrailing={descriptor.overviewTrailing}
				summaryRefreshStatus={props.summaryRefreshStatus}
				overviewNoticeTitle={descriptor.creditCopy.notice}
				overviewRefreshStatus={props.overviewRefreshStatus}
				summaryUnavailable={summaryState.summaryUnavailable}
				overviewLoadingDetail={descriptor.overviewLoadingDetail}
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
				backdropPurposes={descriptor.backdropPurposes}
				overviewAssets={mediaGroupOverviewManagedAssets}
			/>
		);
	}

	function Facts(props: { readonly compact: boolean; readonly data: Presentation }) {
		const { data } = props;
		const release = mediaReleaseLabel(data);
		const progress =
			data.state === "in_progress" && data.progressPercent !== null
				? `${decimalLabel(data.progressPercent)}% ${descriptor.progressVerb}`
				: undefined;
		return (
			<div className={clsx("flex min-w-0 flex-col", props.compact ? "gap-1" : "gap-1.5")}>
				<div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-ui text-[12px] text-text-muted">
					{release === undefined ? null : <span>{release}</span>}
					{descriptor.presentationFacts(data).map((fact) => (
						<span key={fact}>{fact}</span>
					))}
					<span className="font-medium text-accent-text">{lifecycleLabel(data)}</span>
				</div>
				{progress === undefined ? null : (
					<p className="font-ui text-[12px] leading-5 text-text-subtle">{progress}</p>
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
		summaryProgress,
		overviewIsEmpty,
		activityRowLabel,
		overviewRelations,
		page: mediaDetailPage(Screen),
		mapSummary: summaryState.mapSummary,
		summaryError: summaryState.summaryError,
		rowPresentation: presentations.rowPresentation,
		cardPresentation: presentations.cardPresentation,
		summaryUnavailable: summaryState.summaryUnavailable,
		overviewManagedAssets: mediaGroupOverviewManagedAssets,
	};
};
