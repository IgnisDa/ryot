import type { EntitySettleReason } from "@ryot-app/plugin-client-sdk";
import type {
	EntityRendererProps,
	PluginIdentityReference,
} from "@ryot-app/plugin-client-sdk/plugin";
import type { PreparedRecipe } from "@ryot-app/plugin-client-sdk/ryotql";
import type { TabOption } from "@ryot-app/plugin-ui-sdk";
import { createElement, type ReactNode } from "react";

import type { MediaReviewActivityResult } from "../../shared/media-recipes";
import {
	mediaCreditItems,
	MediaCreditRails,
	mediaCreditRailsAreEmpty,
	mediaCreditRailsManagedAssets,
	type MediaCreditRailsOverview,
	type MediaCreditSection,
} from "./credit-rails";
import { createMediaCreditsQuery, type MediaCreditsRecipe } from "./credits";
import { createMediaEntityQuery, createMediaSummaryQuery } from "./detail-queries";
import {
	MediaDetailBody,
	type MediaDetailBodyInput,
	mediaDetailPage,
	MediaDetailScreen,
} from "./detail-screen";
import type { MediaOverviewRelationsRender } from "./overview";
import type { MediaOverviewState } from "./overview-state";
import { mediaReviewActivityView } from "./review-activity-state";
import { defineMediaReviewActivityTab } from "./review-activity-tab";
import {
	type MediaEntitySummaryValue,
	type MediaSummaryArtwork,
	type MediaSummaryFact,
	type MediaSummaryHeaderDetail,
	type MediaSummaryLink,
	type MediaSummaryState,
	mediaSummaryStateMapper,
} from "./summary-state";

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
		readonly creditsRecipe: MediaCreditsRecipe<{ readonly target: Slug }>;
		readonly summaryRecipe: (input: {
			readonly reference: PluginIdentityReference;
			readonly entityId: string;
			readonly collectionLimit: number;
		}) => PreparedRecipe<CreatorSummaryResult<Summary>>;
		readonly overviewRecipe: (input: {
			readonly reference: PluginIdentityReference;
			readonly entityId: string;
			readonly creditLimit: number;
		}) => PreparedRecipe<Overview>;
		readonly activityRecipe: (input: {
			readonly reference: PluginIdentityReference;
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

const TABS: readonly TabOption<"overview" | "activity">[] = [
	{ value: "overview", label: "Overview" },
	{ value: "activity", label: "Activity" },
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
	const creditsQuery = createMediaCreditsQuery(recipes.creditsRecipe);

	const overviewQuery = createMediaEntityQuery(
		(input) =>
			recipes.overviewRecipe({
				entityId: input.entityId,
				creditLimit: CREDIT_LIMIT,
				reference: input.reference,
			}),
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
		overview,
		entityId,
		safeAreaTop,
	}) => (
		<MediaCreditRails
			compact={compact}
			entityId={entityId}
			overview={overview}
			safeAreaTop={safeAreaTop}
			creditsQuery={creditsQuery}
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
