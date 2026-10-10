import type { EntitySettleReason } from "@ryot-app/plugin-client-sdk";
import type {
	EntityRendererProps,
	PluginIdentityReference,
} from "@ryot-app/plugin-client-sdk/plugin";
import { createRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import type { PreparedRecipe } from "@ryot-app/plugin-client-sdk/ryotql";
import type { TabOption } from "@ryot-app/plugin-ui-sdk";
import clsx from "clsx";
import { createElement, type ReactNode } from "react";

import type { MediaPresentationSource } from "../../shared/entity-presentations";
import type { MediaReviewActivityResult } from "../../shared/media-recipes";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { createMediaCreditsQuery, MediaCreditsButton, type MediaCreditsRecipe } from "./credits";
import { type MediaCursorPage, mediaCursorPageError } from "./cursor-page-state";
import { MediaCursorPages, type MediaCursorPagesCopy } from "./cursor-pages";
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
import { collectManagedAssetLocators, type MediaImagePurposes } from "./image";
import {
	MediaCreditColumns,
	type MediaCreditCopy,
	type MediaOverviewRelationsRender,
} from "./overview";
import {
	type MediaCompany,
	mediaCreditAssets,
	type MediaCreditPerson,
	type MediaOverviewState,
} from "./overview-state";
import { defineMediaReviewActivityTab } from "./review-activity-tab";
import {
	mediaCountFact,
	mediaCountLabels,
	type MediaEntitySummaryValue,
	mediaSourceLinks,
	type MediaStatusTone,
	type MediaSummaryHeaderDetail,
	type MediaSummaryState,
	mediaSummaryStateMapper,
} from "./summary-state";

const MEMBER_PAGE_LIMIT = 20;
const PEOPLE_LIMIT = 12;
const COMPANY_LIMIT = 6;

type GroupProgress = {
	readonly parts: number | null;
	readonly memberCount: number;
	readonly completedMemberCount: number;
};

type GroupSummary = MediaEntitySummaryValue &
	GroupProgress & {
		readonly sourceUrl: string | null;
		readonly collections: { readonly items: readonly { readonly id: string }[] };
	};

type GroupPresentation = MediaSavedViewPresentationSubject & GroupProgress;

type GroupMember = MediaSavedViewPresentationSubject & { readonly position: number | null };

type GroupCredits = {
	readonly people: { readonly items: readonly MediaCreditPerson[] };
	readonly companies: { readonly items: readonly MediaCompany[] };
};

type GroupSummaryResult<Summary> = {
	readonly summary: Summary | null;
	readonly entitySchemaSlug: string | null;
};

type GroupOverview<Overview> = Overview | Record<never, never>;

type MediaGroupSchemaRecipes<Summary, Presentation, Member> = {
	readonly peopleRecipe: MediaCreditsRecipe;
	readonly summaryRecipe: (input: {
		readonly reference: PluginIdentityReference;
		readonly entityId: string;
		readonly collectionLimit: number;
	}) => PreparedRecipe<GroupSummaryResult<Summary>>;
	readonly membersRecipe: (input: {
		readonly reference: PluginIdentityReference;
		readonly limit: number;
		readonly groupId: string;
		readonly after?: string | undefined;
	}) => PreparedRecipe<MediaCursorPage<Member>>;
	readonly activityRecipe: (input: {
		readonly reference: PluginIdentityReference;
		readonly entityId: string;
		readonly eventLimit: number;
		readonly collectionEventLimit: number;
	}) => PreparedRecipe<MediaReviewActivityResult>;
	readonly presentationSource: MediaPresentationSource<Presentation>;
};

type MediaGroupOverviewRecipe<Overview> = (input: {
	readonly reference: PluginIdentityReference;
	readonly entityId: string;
	readonly peopleLimit: number;
	readonly companyLimit: number;
}) => PreparedRecipe<Overview>;

export type MediaGroupSchemaDescriptor<
	Summary extends GroupSummary,
	Presentation extends GroupPresentation,
	Member extends GroupMember,
	Overview extends GroupCredits,
> = {
	readonly aspect: MediaArtworkAspect;
	readonly heroHeight: (compact: boolean) => number;
	readonly backdropPurposes?: MediaImagePurposes;
	readonly nouns: { readonly title: string; readonly singular: string; readonly plural: string };
	readonly members: { readonly tab: string; readonly noun: string; readonly verb: string };
	readonly member: {
		readonly RowContent: (props: {
			readonly compact: boolean;
			readonly entityId: string;
			readonly position?: string | undefined;
			readonly data: MediaPresentationViewData<NoInfer<Member>>;
		}) => ReactNode;
	};
} & (
	| {
			readonly creditCopy: MediaCreditCopy;
			readonly recipes: MediaGroupSchemaRecipes<Summary, Presentation, Member> & {
				readonly overviewRecipe: MediaGroupOverviewRecipe<Overview>;
			};
	  }
	| {
			readonly creditCopy?: undefined;
			readonly recipes: MediaGroupSchemaRecipes<Summary, Presentation, Member> & {
				readonly overviewRecipe?: undefined;
			};
	  }
);

type GroupTabKey = "members" | "overview" | "activity";

const groupProgressLabel = (progress: GroupProgress, verb: string) =>
	progress.memberCount === 0
		? undefined
		: `${progress.completedMemberCount} of ${progress.memberCount} ${verb}`;

const groupProgressTone = (progress: GroupProgress): MediaStatusTone => {
	if (progress.completedMemberCount === progress.memberCount) {
		return "success";
	}
	return progress.completedMemberCount > 0 ? "accent" : "neutral";
};

const memberAssets = (items: readonly MediaSavedViewPresentationSubject[]) =>
	collectManagedAssetLocators(items.map(({ image }) => image ?? undefined));

const groupCreditsAreEmpty = <Overview extends GroupCredits>(overview: GroupOverview<Overview>) =>
	!("people" in overview) ||
	(overview.people.items.length === 0 && overview.companies.items.length === 0);

export const defineGroupMediaSchema = <
	Summary extends GroupSummary,
	Presentation extends GroupPresentation,
	Member extends GroupMember,
	Overview extends GroupCredits,
>(
	descriptor: MediaGroupSchemaDescriptor<Summary, Presentation, Member, Overview>,
) => {
	const { nouns, members, recipes } = descriptor;
	const MemberRow = descriptor.member.RowContent;
	const creditCopy = descriptor.creditCopy;
	const overviewRecipe = recipes.overviewRecipe;
	const peopleQuery = createMediaCreditsQuery(recipes.peopleRecipe);

	const tabs: readonly TabOption<GroupTabKey>[] = [
		{ value: "members", label: members.tab },
		{ value: "overview", label: "Overview" },
		{ value: "activity", label: "Activity" },
	];

	const summaryQuery = createMediaSummaryQuery(recipes.summaryRecipe);

	const overviewQuery =
		overviewRecipe === undefined
			? undefined
			: createMediaEntityQuery(
					({ entityId, reference }) =>
						overviewRecipe({
							entityId,
							reference,
							peopleLimit: PEOPLE_LIMIT,
							companyLimit: COMPANY_LIMIT,
						}),
					(data) => [...data.people.items, ...data.companies.items].map(({ id }) => id),
				);

	const membersQuery = createRyotQuery<
		{ readonly entityId: string; readonly after: string | null },
		MediaCursorPage<Member>
	>(
		({ input, client }) =>
			client.data.query(
				recipes.membersRecipe({
					groupId: input.entityId,
					limit: MEMBER_PAGE_LIMIT,
					reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
					...(input.after === null ? {} : { after: input.after }),
				}),
			),
		{
			entityWatch: ({ data, input }) => ({
				foreground: [input.entityId],
				visible: data?.items.map(({ id }) => id) ?? [],
			}),
		},
	);

	const summaryState = mediaSummaryStateMapper<GroupSummaryResult<Summary>, Summary>({
		...nouns,
		select: ({ summary }) => summary,
	});

	const { Activity, ActivityTab, mapActivity, activityQuery } = defineMediaReviewActivityTab({
		noun: nouns.singular,
		activityRecipe: recipes.activityRecipe,
	});

	const header = (summary: Summary): MediaSummaryHeaderDetail => {
		const status = groupProgressLabel(summary, members.verb);
		return {
			chips: [],
			identityDetail: undefined,
			links: mediaSourceLinks(summary),
			facts: [mediaCountFact(summary.parts, members.noun, "layers-3")].filter(
				(fact) => fact !== undefined,
			),
			rail: {
				logActivity: false,
				status:
					status === undefined
						? undefined
						: {
								label: status,
								tone: groupProgressTone(summary),
								progress: { percent: (summary.completedMemberCount / summary.memberCount) * 100 },
							},
			},
		};
	};

	const membersCopy: MediaCursorPagesCopy = {
		error: (state) => mediaCursorPageError({ state, noun: members.tab.toLowerCase() }),
		empty: `No ${members.tab.toLowerCase()} have been linked to this ${nouns.singular} yet.`,
		loading: {
			title: `Loading ${members.tab.toLowerCase()}...`,
			detail: `Fetching the ${members.tab.toLowerCase()} in this ${nouns.singular}.`,
		},
	};

	function MembersTab(props: { readonly compact: boolean; readonly entityId: string }) {
		return (
			<div className={clsx("flex flex-col", props.compact ? "gap-5 pt-6" : "gap-6 pt-8")}>
				<MediaCursorPages
					copy={membersCopy}
					query={membersQuery}
					key={props.entityId}
					assets={memberAssets}
					input={{ entityId: props.entityId }}
					getPageInput={(input, after) => ({ ...input, after })}
					renderPage={(items) => {
						const batchAssets = memberAssets(items);
						return (
							<div>
								{items.map((item) => (
									<MemberRow
										key={item.id}
										entityId={item.id}
										compact={props.compact}
										data={{ ...item, batchAssets }}
										position={item.position === null ? undefined : String(item.position)}
									/>
								))}
							</div>
						);
					}}
				/>
			</div>
		);
	}

	const overviewRelations: MediaOverviewRelationsRender<GroupOverview<Overview>> = ({
		compact,
		entityId,
		overview,
		safeAreaTop,
	}) =>
		creditCopy === undefined || !("people" in overview) ? null : (
			<MediaCreditColumns
				copy={creditCopy}
				compact={compact}
				people={overview.people.items}
				companies={overview.companies.items}
				peopleAction={
					<MediaCreditsButton
						aspect="square"
						compact={compact}
						purpose="profile"
						query={peopleQuery}
						input={{ entityId }}
						label="View all people"
						title={creditCopy.people}
						safeAreaTop={safeAreaTop}
					/>
				}
			/>
		);

	function ScreenBody(props: {
		readonly compact: boolean;
		readonly safeAreaTop: number;
		readonly refresh: () => void;
		readonly members: ReactNode;
		readonly activity: ReactNode;
		readonly refreshOverview: () => void;
		readonly summaryRefreshStatus?: ReactNode;
		readonly overviewRefreshStatus?: ReactNode;
		readonly state: MediaSummaryState<Summary>;
		readonly settled: EntitySettleReason | undefined;
		readonly overview: MediaOverviewState<GroupOverview<Overview>>;
	}) {
		return (
			<MediaDetailBody
				tabs={tabs}
				header={header}
				state={props.state}
				defaultTab="members"
				overviewTab="overview"
				compact={props.compact}
				settled={props.settled}
				refresh={props.refresh}
				overview={props.overview}
				loading={summaryState.loading}
				safeAreaTop={props.safeAreaTop}
				overviewRelations={overviewRelations}
				overviewIsEmpty={groupCreditsAreEmpty}
				refreshOverview={props.refreshOverview}
				summaryError={summaryState.summaryError}
				summaryRefreshStatus={props.summaryRefreshStatus}
				overviewRefreshStatus={props.overviewRefreshStatus}
				overviewNoticeTitle={creditCopy?.notice ?? "Images"}
				summaryUnavailable={summaryState.summaryUnavailable}
				artwork={{ purpose: "cover", aspect: descriptor.aspect }}
				tabContent={{ members: props.members, activity: props.activity }}
				overviewLoadingDetail={`Fetching the credits for this ${nouns.singular}.`}
				overviewEmpty={{
					title: "Nothing more to show",
					detail: `This ${nouns.singular} has no images or credits yet.`,
				}}
			/>
		);
	}

	const DetailBody = (input: MediaDetailBodyInput<Summary, GroupOverview<Overview>>) => (
		<ScreenBody
			{...input}
			members={createElement(MembersTab, { compact: input.compact, entityId: input.entityId })}
			activity={createElement(ActivityTab, { compact: input.compact, entityId: input.entityId })}
		/>
	);

	function Screen(props: EntityRendererProps) {
		const screen = {
			summaryQuery,
			Body: DetailBody,
			entityId: props.entityId,
			heroHeight: descriptor.heroHeight,
			mapSummary: summaryState.mapSummary,
			backdropPurposes: descriptor.backdropPurposes,
		};
		return overviewQuery === undefined ? (
			<MediaDetailScreen {...screen} />
		) : (
			<MediaDetailScreen
				{...screen}
				overviewQuery={overviewQuery}
				overviewAssets={(overview) => collectManagedAssetLocators(mediaCreditAssets(overview))}
			/>
		);
	}

	function Facts(props: { readonly compact: boolean; readonly data: Presentation }) {
		const { data } = props;
		const progress = groupProgressLabel(data, members.verb);
		return (
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-ui text-[12px] text-text-muted">
				{mediaCountLabels(data.parts, members.noun).map((fact) => (
					<span key={fact}>{fact}</span>
				))}
				{progress === undefined ? null : (
					<span className="font-medium text-accent-text">{progress}</span>
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
		MembersTab,
		ScreenBody,
		RowContent,
		mapActivity,
		ActivityTab,
		CardContent,
		summaryQuery,
		membersQuery,
		overviewQuery,
		activityQuery,
		page: mediaDetailPage(Screen),
		mapSummary: summaryState.mapSummary,
		summaryError: summaryState.summaryError,
		rowPresentation: presentations.rowPresentation,
		cardPresentation: presentations.cardPresentation,
		summaryUnavailable: summaryState.summaryUnavailable,
	};
};
