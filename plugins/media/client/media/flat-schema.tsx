import type { EntitySettleReason, LocalMessage } from "@ryot-app/plugin-client-sdk";
import type { EntityRendererProps } from "@ryot-app/plugin-client-sdk/plugin";
import type { Formatters } from "@ryot-app/plugin-client-sdk/react";
import type { SelectedRowsSource } from "@ryot-app/plugin-client-sdk/ryotql";
import type { TabOption } from "@ryot-app/plugin-ui-sdk";
import clsx from "clsx";
import { createElement, type ReactNode } from "react";

import { sameMediaPosition } from "../../shared/consumption";
import type { MediaLifecycleState } from "../../shared/lifecycle-expressions";
import type {
	MediaFlatActivityEvent,
	MediaUnlinkedCreatorsOverview,
} from "../../shared/media-recipes";
import { catalogMessage } from "../../shared/messages.generated";
import { type MediaCopy, type MediaText, useMediaCopy, useMediaMessages } from "../messages";
import {
	mediaActivityRunLabel,
	type MediaFlatActivityCopy,
	mediaPositionLabel,
} from "./activity-copy";
import { createMediaHistoryQuery, type MediaHistoryRecipe } from "./activity-history";
import type { MediaActivityLogger } from "./activity-log/state";
import {
	MediaActivityReviewDetail,
	type MediaActivityRowRender,
	MediaActivityRows,
} from "./activity-rows";
import { defineMediaActivityTab, MediaActivityRecord } from "./activity-tab";
import { mediaCollectionRowLabel, mergeActivityRuns } from "./activity-timeline";
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
	type MediaPresentationSubject,
	type MediaPresentationViewData,
	MediaRowContent,
	type MediaSavedViewPresentationSubject,
} from "./entity-presentation";
import { MediaEntityRailSection } from "./entity-rail";
import {
	mediaFlatActivityFigures,
	type MediaFlatActivityProgressRow,
	type MediaFlatActivityRow,
	mediaFlatActivityRow,
	type MediaFlatActivitySummary,
	type MediaFlatActivityView,
	mediaFlatActivityView,
	mergeFlatRuns,
} from "./flat-activity-state";
import {
	type MediaGroupOverview,
	mediaGroupOverviewIsEmpty,
	mediaGroupOverviewManagedAssets,
	MediaPartOfSection,
} from "./group-section";
import { collectManagedAssetLocators } from "./image";
import {
	type MediaCreditCopy,
	MediaOverviewRelations,
	type MediaOverviewRelationsRender,
} from "./overview";
import {
	type MediaOverviewState,
	mediaUnlinkedCreators,
	mediaUnlinkedCredits,
} from "./overview-state";
import {
	mediaFlatLifecycleLabel,
	mediaPosterAsset,
	mediaReleaseLabel,
	type MediaSummaryFact,
	mediaSummaryHeaderDetail,
	type MediaSummaryState,
	mediaSummaryStateMapper,
	type MediaSummaryValue,
} from "./summary-state";

type FlatReviewSubject = { readonly on: "media" };

const REVIEW_SUBJECT: FlatReviewSubject = { on: "media" };

export type MediaFlatSchemaRow<Extra = unknown> = MediaFlatActivityRow<FlatReviewSubject, Extra>;

export type MediaFlatSchemaActivityView<Extra = unknown> = MediaFlatActivityView<
	FlatReviewSubject,
	Extra
>;

export type MediaOverviewRail = {
	readonly key: string;
	/** A plain string is provider text, shown as written. */
	readonly title: string | LocalMessage;
	readonly items: readonly (MediaPresentationSubject & { readonly isInMediaLibrary: boolean })[];
};

export type MediaFlatActivityResult<Extra = unknown> = {
	readonly truncated: boolean;
	readonly completionCount: number;
	readonly unknownAmountCount: number;
	readonly consumedAmount: null | number;
	readonly events: readonly MediaFlatActivityEvent<Extra>[];
	readonly consumptionProcessing: "ready" | "failed" | "pending";
};

export type MediaFlatSchemaDescriptor<
	Summary extends FlatSummary,
	Overview extends MediaGroupOverview & MediaUnlinkedCreatorsOverview,
	Presentation extends FlatPresentation,
	Extra = unknown,
> = {
	readonly aspect: MediaArtworkAspect;
	readonly creditCopy: MediaCreditCopy;
	readonly logActivity: MediaActivityLogger;
	readonly overviewLoadingDetail: LocalMessage;
	readonly group?: { readonly actionLabel: LocalMessage };
	readonly activityCopy: (copy: MediaCopy) => MediaFlatActivityCopy<Extra>;
	readonly overviewRails?: (overview: Overview) => readonly MediaOverviewRail[];
	readonly facts: (summary: Summary, copy: MediaCopy) => readonly MediaSummaryFact[];
	readonly presentationFacts: (data: Presentation, copy: MediaCopy) => readonly string[];
	readonly overviewTrailing?: (input: {
		readonly summary: Summary;
		readonly compact: boolean;
	}) => ReactNode;
	readonly measureFigure: {
		readonly label: LocalMessage;
		readonly value: (formatters: Formatters, amount: MediaFlatActivitySummary["amount"]) => string;
	};
	readonly recipes: {
		readonly peopleRecipe: MediaCreditsRecipe;
		readonly companiesRecipe: MediaCreditsRecipe;
		readonly overviewRecipe: MediaEntityRecipe<Overview>;
		readonly presentationSource: SelectedRowsSource<Presentation>;
		readonly summaryRecipe: MediaEntityRecipe<FlatSummaryResult<Summary>>;
		readonly historyRecipe: MediaHistoryRecipe<MediaFlatActivityEvent<NoInfer<Extra>>>;
		readonly activityRecipe: MediaEntityRecipe<MediaFlatActivityResult<NoInfer<Extra>>>;
	};
};

type FlatSummaryResult<Summary> = {
	readonly summary: null | Summary;
	readonly entitySchemaSlug: null | string;
};

type FlatSummary = MediaSummaryValue & {
	readonly state: MediaLifecycleState;
	readonly progressPercent: null | number;
	readonly collections: { readonly items: readonly { readonly id: string }[] };
};

type FlatPresentation = MediaSavedViewPresentationSubject & {
	readonly state: MediaLifecycleState;
	readonly publishDate: null | string;
	readonly publishYear: null | number;
	readonly progressPercent: null | number;
};

const tabs = (text: MediaText): readonly TabOption<"overview" | "activity">[] => [
	{ value: "overview", label: text("tabs.overview") },
	{ value: "activity", label: text("browse.field.activity") },
];

const lifecycleLabel = (text: MediaText, media: { readonly state: MediaLifecycleState }) =>
	mediaFlatLifecycleLabel(text, media.state);

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
	const { recipes } = descriptor;

	const summaryQuery = createMediaSummaryQuery(recipes.summaryRecipe);
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
	const railsOf = (overview: Overview) => descriptor.overviewRails?.(overview) ?? [];

	const overviewIsEmpty = (overview: Overview) =>
		mediaGroupOverviewIsEmpty(overview, mediaUnlinkedCreators(overview)) &&
		railsOf(overview).every((rail) => rail.items.length === 0);

	const overviewManagedAssets = (overview: Overview) =>
		collectManagedAssetLocators([
			...mediaGroupOverviewManagedAssets(overview),
			...railsOf(overview).flatMap((rail) => rail.items.map((item) => mediaPosterAsset(item))),
		]);

	const overviewQuery = createMediaEntityQuery(
		(input) => recipes.overviewRecipe({ reference: input.reference }),
		(data) =>
			[
				...data.people.items,
				...data.companies.items,
				...data.recommendations.items,
				...(data.group?.members.items ?? []),
				...railsOf(data).flatMap((rail) => rail.items),
			].map(({ id }) => id),
	);

	const activityQuery = createMediaEntityQuery(
		(input) => recipes.activityRecipe({ reference: input.reference }),
		(data) =>
			data.events.flatMap((event) => (event.kind === "collection" ? [event.collection.id] : [])),
	);

	const summaryState = mediaSummaryStateMapper<FlatSummaryResult<Summary>, Summary>(
		({ summary }) => summary,
	);

	const sameProgressTarget = (
		current: MediaFlatActivityProgressRow<Extra>,
		next: MediaFlatActivityProgressRow<Extra>,
	) =>
		current.position === null || next.position === null
			? current.position === next.position
			: sameMediaPosition(current.position, next.position);

	const mergeRuns = mergeFlatRuns<FlatReviewSubject, Extra>(sameProgressTarget);

	const activityView = (result: MediaFlatActivityResult<Extra>) =>
		mediaFlatActivityView({
			merge: mergeRuns,
			events: result.events,
			subject: REVIEW_SUBJECT,
			truncated: result.truncated,
			completions: result.completionCount,
			processing: result.consumptionProcessing,
			amount: { total: result.consumedAmount ?? 0, missing: result.unknownAmountCount },
		});

	const activityRowLabel = (copy: MediaCopy, row: MediaFlatSchemaRow<Extra>): string => {
		const { text } = copy;
		const activityCopy = descriptor.activityCopy(copy);
		if (row.type === "item") {
			return row.item === null
				? text("event-schema.item-complete.name")
				: activityCopy.itemLabel(row.item);
		}
		if (row.type === "completion") {
			return activityCopy.rowLabels.completion;
		}
		if (row.type === "collection") {
			return mediaCollectionRowLabel(text, row);
		}
		if (row.type === "media-library") {
			return activityCopy.libraryLabel;
		}
		if (row.type === "beat") {
			return row.beat === "backlog" ? text("activity.beat-backlog") : activityCopy.beats[row.beat];
		}
		if (row.type === "progress") {
			return row.position === null
				? activityCopy.rowLabels.progress(row.percent, row.extra)
				: mediaPositionLabel(text, row.position);
		}
		if (row.type === "snapshot") {
			return activityCopy.snapshot.label;
		}
		return row.position !== undefined
			? text("activity.row-with-position", {
					label: activityCopy.rowLabels.review,
					position: mediaPositionLabel(text, row.position),
				})
			: activityCopy.rowLabels.review;
	};

	const activityRender = (copy: MediaCopy): MediaActivityRowRender<MediaFlatSchemaRow<Extra>> => ({
		rowLabel: (row) => activityRowLabel(copy, row),
		segment: descriptor.activityCopy(copy).segment,
		rowSource: (row) => (row.type === "progress" ? row.source : undefined),
		rowRun: (row) =>
			(row.type === "progress" || row.type === "completion") && row.run !== undefined
				? mediaActivityRunLabel(copy, row.run)
				: undefined,
		rowBody: (row) => {
			if (row.type === "review") {
				return <MediaActivityReviewDetail row={row} />;
			}
			if (row.type === "snapshot") {
				const detail = descriptor.activityCopy(copy).snapshot.detail(row.extra);
				return detail === undefined ? null : (
					<p className="text-micro text-text-subtle">{detail}</p>
				);
			}
			return null;
		},
	});

	function ActivityRecord(props: {
		readonly compact: boolean;
		readonly history?: ReactNode;
		readonly view: MediaFlatSchemaActivityView<Extra>;
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
				figures={mediaFlatActivityFigures(copy, view.summary, {
					measure: descriptor.measureFigure,
					completions: activityCopy.completionsLabel,
				})}
			/>
		);
	}

	function ActivityHistoryRows(props: {
		readonly compact: boolean;
		readonly events: readonly MediaFlatActivityEvent<Extra>[];
	}) {
		const copy = useMediaCopy();
		return (
			<MediaActivityRows
				compact={props.compact}
				render={activityRender(copy)}
				rows={mergeActivityRuns(
					props.events.map((event) => mediaFlatActivityRow(event, REVIEW_SUBJECT)),
					mergeRuns,
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
		hasMoreActivities: (result) => result.truncated,
		renderHistory: (events, compact) => <ActivityHistoryRows events={events} compact={compact} />,
		historyQuery: createMediaHistoryQuery(recipes.historyRecipe, (events) =>
			events.flatMap((event) => (event.kind === "collection" ? [event.collection.id] : [])),
		),
	});

	const header = mediaSummaryHeaderDetail({
		facts: descriptor.facts,
		progress: summaryProgress,
		logActivity: descriptor.logActivity,
	});

	const overviewRelations: MediaOverviewRelationsRender<Overview> = ({
		compact,
		entityId,
		overview,
		safeAreaTop,
	}) => {
		const groupCopy = descriptor.group;
		const group = groupCopy === undefined ? null : (overview.group ?? null);
		const unlinked = mediaUnlinkedCreators(overview);
		return (
			<MediaOverviewRelations
				compact={compact}
				overview={overview}
				unlinked={unlinked}
				aspect={descriptor.aspect}
				copy={descriptor.creditCopy}
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
						unlinked={mediaUnlinkedCredits(unlinked).people}
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
						unlinked={mediaUnlinkedCredits(unlinked).companies}
					/>
				}
				trailing={
					<>
						{group === null || groupCopy === undefined ? null : (
							<MediaPartOfSection
								group={group}
								compact={compact}
								aspect={descriptor.aspect}
								actionLabel={groupCopy.actionLabel}
								title={catalogMessage("group.part-of", { name: group.name })}
							/>
						)}
						{railsOf(overview).map((rail) => (
							<MediaEntityRailSection
								key={rail.key}
								compact={compact}
								items={rail.items}
								title={rail.title}
								aspect={() => descriptor.aspect}
							/>
						))}
					</>
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
				tabContent={{ activity: props.activity }}
				overviewTrailing={descriptor.overviewTrailing}
				summaryRefreshStatus={props.summaryRefreshStatus}
				overviewNoticeTitle={descriptor.creditCopy.notice}
				overviewRefreshStatus={props.overviewRefreshStatus}
				summaryUnavailable={summaryState.summaryUnavailable}
				overviewLoadingDetail={descriptor.overviewLoadingDetail}
				artwork={{ purpose: "cover", aspect: descriptor.aspect }}
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
				overviewAssets={overviewManagedAssets}
			/>
		);
	}

	function Facts(props: { readonly compact: boolean; readonly data: Presentation }) {
		const { data } = props;
		const copy = useMediaCopy();
		const release = mediaReleaseLabel(data);
		const progress =
			data.state === "in_progress" && data.progressPercent !== null
				? descriptor.activityCopy(copy).progressLabel(data.progressPercent)
				: undefined;
		return (
			<div className={clsx("flex min-w-0 flex-col", props.compact ? "gap-1" : "gap-1.5")}>
				<div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-ui text-[12px] text-text-muted">
					{release === undefined ? null : <span>{release}</span>}
					{descriptor.presentationFacts(data, copy).map((fact) => (
						<span key={fact}>{fact}</span>
					))}
					<span className="font-medium text-accent-text">{lifecycleLabel(copy.text, data)}</span>
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
		readonly position?: string | undefined;
		readonly isInMediaLibrary?: boolean | undefined;
		readonly data: MediaPresentationViewData<Presentation>;
	}) {
		return (
			<MediaRowContent
				data={props.data}
				compact={props.compact}
				entityId={props.entityId}
				position={props.position}
				aspect={descriptor.aspect}
				isInMediaLibrary={props.isInMediaLibrary}
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
		summaryProgress,
		overviewIsEmpty,
		activityRowLabel,
		overviewRelations,
		overviewManagedAssets,
		page: mediaDetailPage(Screen),
		mapSummary: summaryState.mapSummary,
		summaryError: summaryState.summaryError,
		rowPresentation: presentations.rowPresentation,
		cardPresentation: presentations.cardPresentation,
		summaryUnavailable: summaryState.summaryUnavailable,
	};
};
