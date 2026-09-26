import type { EntitySettleReason } from "@ryot-app/client-sdk";
import type { EntityRendererProps } from "@ryot-app/client-sdk/plugin";
import type { PreparedRecipe } from "@ryot-app/client-sdk/ryotql";
import { createElement, type ReactNode } from "react";

import type { MediaReviewActivityResult } from "../../shared/media-recipes";
import {
	MediaCreditRails,
	mediaCreditItems,
	mediaCreditRailsAreEmpty,
	mediaCreditRailsManagedAssets,
	type MediaCreditRailsOverview,
	type MediaCreditSection,
} from "./credit-rails";
import { createMediaEntityQuery, createMediaSummaryQuery } from "./detail-queries";
import {
	MediaDetailBody,
	MediaDetailScreen,
	mediaDetailPage,
	type MediaDetailBodyInput,
} from "./detail-screen";
import type { MediaOverviewRelationsRender } from "./overview";
import type { MediaOverviewState } from "./overview-state";
import { mediaReviewActivityView } from "./review-activity-state";
import { defineMediaReviewActivityTab } from "./review-activity-tab";
import {
	mediaSummaryStateMapper,
	type MediaEntitySummaryValue,
	type MediaSummaryArtwork,
	type MediaSummaryFact,
	type MediaSummaryHeaderDetail,
	type MediaSummaryLink,
	type MediaSummaryState,
} from "./summary-state";
import type { MediaTab } from "./tabs";

const CREDIT_LIMIT = 12;
const ALIAS_CHIP_LIMIT = 4;

type CreatorSummary = MediaEntitySummaryValue & {
	readonly alternateNames: readonly string[] | null;
	readonly collections: { readonly items: readonly { readonly id: string }[] };
};

type CreatorSummaryResult<Summary> = {
	readonly summary: Summary | null;
	readonly entitySchemaSlug: string | null;
};

export type MediaCreatorSchemaDescriptor<
	Summary extends CreatorSummary,
	Slug extends string,
	Overview extends MediaCreditRailsOverview<Slug>,
> = {
	readonly recipes: {
		readonly summaryRecipe: (input: {
			readonly entityId: string;
			readonly collectionLimit: number;
		}) => PreparedRecipe<CreatorSummaryResult<Summary>>;
		readonly overviewRecipe: (input: {
			readonly entityId: string;
			readonly creditLimit: number;
		}) => PreparedRecipe<Overview>;
		readonly activityRecipe: (input: {
			readonly entityId: string;
			readonly eventLimit: number;
			readonly collectionEventLimit: number;
		}) => PreparedRecipe<MediaReviewActivityResult>;
	};
	readonly artwork: MediaSummaryArtwork;
	readonly heroHeight: (compact: boolean) => number;
	readonly creditSections: readonly MediaCreditSection<Slug>[];
	readonly nouns: { readonly title: string; readonly singular: string; readonly plural: string };
	readonly facts: (summary: Summary) => readonly MediaSummaryFact[];
	readonly links: (summary: Summary) => readonly MediaSummaryLink[];
};

const TABS: readonly MediaTab<"overview" | "activity">[] = [
	{ key: "overview", label: "Overview" },
	{ key: "activity", label: "Activity" },
];

const CREDITS_NOTICE = "Credits";

export const defineCreatorMediaSchema = <
	Summary extends CreatorSummary,
	Slug extends string,
	Overview extends MediaCreditRailsOverview<Slug>,
>(
	descriptor: MediaCreatorSchemaDescriptor<Summary, Slug, Overview>,
) => {
	const { nouns, recipes } = descriptor;

	const summaryQuery = createMediaSummaryQuery(recipes.summaryRecipe);

	const overviewQuery = createMediaEntityQuery(
		(input) => recipes.overviewRecipe({ entityId: input.entityId, creditLimit: CREDIT_LIMIT }),
		(data) => mediaCreditItems<Slug>(data).map(({ id }) => id),
	);

	const summaryState = mediaSummaryStateMapper<CreatorSummaryResult<Summary>, Summary>({
		...nouns,
		select: ({ summary }) => summary,
	});

	const { Activity, ActivityTab, mapActivity, activityQuery } = defineMediaReviewActivityTab({
		noun: nouns.singular,
		activityRecipe: recipes.activityRecipe,
	});

	const header = (summary: Summary): MediaSummaryHeaderDetail => ({
		identityDetail: undefined,
		rail: { logActivity: false },
		facts: descriptor.facts(summary),
		links: descriptor.links(summary),
		chips: (summary.alternateNames ?? []).slice(0, ALIAS_CHIP_LIMIT),
	});

	const overviewIsEmpty = (overview: Overview) => mediaCreditRailsAreEmpty<Slug>(overview);

	const overviewManagedAssets = (overview: Overview) =>
		mediaCreditRailsManagedAssets<Slug>(overview);

	const overviewRelations: MediaOverviewRelationsRender<Overview> = ({
		compact,
		divided,
		overview,
	}) => (
		<MediaCreditRails
			compact={compact}
			divided={divided}
			overview={overview}
			noun={nouns.singular}
			sections={descriptor.creditSections}
		/>
	);

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
				header={header}
				state={props.state}
				defaultTab="overview"
				overviewTab="overview"
				compact={props.compact}
				settled={props.settled}
				refresh={props.refresh}
				typeLabel={nouns.title}
				overview={props.overview}
				artwork={descriptor.artwork}
				loading={summaryState.loading}
				safeAreaTop={props.safeAreaTop}
				overviewIsEmpty={overviewIsEmpty}
				overviewNoticeTitle={CREDITS_NOTICE}
				overviewRelations={overviewRelations}
				refreshOverview={props.refreshOverview}
				summaryError={summaryState.summaryError}
				tabContent={{ activity: props.activity }}
				summaryRefreshStatus={props.summaryRefreshStatus}
				overviewRefreshStatus={props.overviewRefreshStatus}
				summaryUnavailable={summaryState.summaryUnavailable}
				overviewLoadingDetail={`Fetching the credits for this ${nouns.singular}.`}
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
				overviewAssets={overviewManagedAssets}
				posterPurpose={descriptor.artwork.purpose}
			/>
		);
	}

	return {
		Screen,
		Activity,
		ScreenBody,
		mapActivity,
		ActivityTab,
		summaryQuery,
		overviewQuery,
		activityQuery,
		overviewIsEmpty,
		overviewRelations,
		overviewManagedAssets,
		page: mediaDetailPage(Screen),
		mapSummary: summaryState.mapSummary,
		activityView: mediaReviewActivityView,
		summaryError: summaryState.summaryError,
		summaryUnavailable: summaryState.summaryUnavailable,
	};
};
