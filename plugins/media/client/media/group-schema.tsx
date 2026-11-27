import type { EntitySettleReason } from "@ryot-app/plugin-client-sdk";
import type {
	EntityRendererProps,
	PluginIdentityReference,
} from "@ryot-app/plugin-client-sdk/plugin";
import { collectManagedAssetLocators, createRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import type { Recipe, SelectedRowsSource } from "@ryot-app/plugin-client-sdk/ryotql";
import type { TabOption } from "@ryot-app/plugin-ui-sdk";
import clsx from "clsx";
import { createElement, type ReactNode } from "react";

import type {
	MediaReviewActivityEvent,
	MediaReviewActivityResult,
} from "../../shared/media-recipes";
import { catalogMessage } from "../../shared/messages.generated";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import type { mediaGroupParameters } from "../../shared/query-parameters";
import {
	type MediaCopy,
	type MediaGroupMemberUnit,
	type MediaReviewKind,
	type MediaText,
	useMediaMessages,
} from "../messages";
import type { MediaHistoryRecipe } from "./activity-history";
import type { ActivityVerb } from "./activity-log/state";
import { createMediaCreditsQuery, MediaCreditsButton, type MediaCreditsRecipe } from "./credits";
import { type MediaCursorPage, mediaCursorPageError } from "./cursor-page-state";
import { MediaCursorPages, type MediaCursorPagesCopy } from "./cursor-pages";
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
export type MediaGroupSchemaDescriptor<
	Summary extends GroupSummary,
	Presentation extends GroupPresentation,
	Member extends GroupMember,
	Overview extends GroupCredits,
> = {
	readonly kind: MediaReviewKind;
	readonly aspect: MediaArtworkAspect;
	readonly members: { readonly verb: ActivityVerb; readonly unit: MediaGroupMemberUnit };
	readonly member: {
		readonly RowContent: (props: {
			readonly compact: boolean;
			readonly entityId: string;
			readonly position?: string | undefined;
			readonly isInMediaLibrary?: boolean | undefined;
			readonly data: MediaPresentationViewData<NoInfer<Member>>;
		}) => ReactNode;
	};
} & (
	| {
			readonly creditCopy?: undefined;
			readonly recipes: { readonly overviewRecipe?: undefined } & MediaGroupSchemaRecipes<
				Summary,
				Presentation,
				Member
			>;
	  }
	| {
			readonly creditCopy: MediaCreditCopy;
			readonly recipes: MediaGroupSchemaRecipes<Summary, Presentation, Member> & {
				readonly overviewRecipe: MediaGroupOverviewRecipe<Overview>;
			};
	  }
);

type GroupOverview<Overview> = Overview | undefined;

type GroupTabKey = "members" | "overview" | "activity";
type MediaGroupOverviewRecipe<Overview> = MediaEntityRecipe<Overview>;
type GroupPresentation = GroupProgress & MediaSavedViewPresentationSubject;

type GroupSummaryResult<Summary> = {
	readonly summary: null | Summary;
	readonly entitySchemaSlug: null | string;
};

type GroupProgress = {
	readonly memberCount: number;
	readonly parts: null | number;
	readonly completedMemberCount: number;
};

type GroupMember = MediaSavedViewPresentationSubject & {
	readonly position: null | number;
	readonly isInMediaLibrary: boolean;
};

type GroupCredits = {
	readonly companies: { readonly items: readonly MediaCompany[] };
	readonly people: { readonly items: readonly MediaCreditPerson[] };
};

type GroupSummary = GroupProgress &
	MediaEntitySummaryValue & {
		readonly sourceUrl: null | string;
		readonly collections: { readonly items: readonly { readonly id: string }[] };
	};
type MediaGroupSchemaRecipes<Summary, Presentation, Member> = {
	readonly peopleRecipe: MediaCreditsRecipe;
	readonly companiesRecipe: MediaCreditsRecipe;
	readonly presentationSource: SelectedRowsSource<Presentation>;
	readonly historyRecipe: MediaHistoryRecipe<MediaReviewActivityEvent>;
	readonly activityRecipe: MediaEntityRecipe<MediaReviewActivityResult>;
	readonly summaryRecipe: MediaEntityRecipe<GroupSummaryResult<Summary>>;
	readonly membersRecipe: (input: {
		readonly reference: PluginIdentityReference;
	}) => Recipe<MediaCursorPage<Member>, typeof mediaGroupParameters.schema>;
};

const groupProgressLabel = (text: MediaText, progress: GroupProgress, verb: ActivityVerb) =>
	progress.memberCount === 0
		? undefined
		: text("group.progress", {
				verb,
				total: progress.memberCount,
				completed: progress.completedMemberCount,
			});

const groupProgressTone = (progress: GroupProgress): MediaStatusTone => {
	if (progress.completedMemberCount === progress.memberCount) {
		return "success";
	}
	return progress.completedMemberCount > 0 ? "accent" : "neutral";
};

const memberAssets = (items: readonly MediaSavedViewPresentationSubject[]) =>
	collectManagedAssetLocators(items.map(({ image }) => image ?? undefined));

const groupCreditsAreEmpty = <Overview extends GroupCredits>(overview: GroupOverview<Overview>) =>
	overview === undefined ||
	(overview.people.items.length === 0 && overview.companies.items.length === 0);

export const defineGroupMediaSchema = <
	Summary extends GroupSummary,
	Presentation extends GroupPresentation,
	Member extends GroupMember,
	Overview extends GroupCredits,
>(
	descriptor: MediaGroupSchemaDescriptor<Summary, Presentation, Member, Overview>,
) => {
	const { kind, members, recipes } = descriptor;
	const MemberRow = descriptor.member.RowContent;
	const creditCopy = descriptor.creditCopy;
	const overviewRecipe = recipes.overviewRecipe;
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
	const tabs = (text: MediaText): readonly TabOption<GroupTabKey>[] => [
		{ value: "members", label: text("group.tab", { unit: members.unit }) },
		{ value: "overview", label: text("tabs.overview") },
		{ value: "activity", label: text("browse.field.activity") },
	];

	const summaryQuery = createMediaSummaryQuery(recipes.summaryRecipe);

	const overviewQuery =
		overviewRecipe === undefined
			? undefined
			: createMediaEntityQuery(overviewRecipe, (data) =>
					[...data.people.items, ...data.companies.items].map(({ id }) => id),
				);

	const membersQuery = createRyotQuery<
		{ readonly entityId: string; readonly after: null | string },
		MediaCursorPage<Member>
	>(
		({ input, client }) =>
			client.data.query(
				recipes.membersRecipe({ reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }),
				{ groupId: input.entityId },
				{ pages: { members: { limit: MEMBER_PAGE_LIMIT, after: input.after ?? undefined } } },
			),
		{
			entityWatch: ({ data, input }) => ({
				foreground: [input.entityId],
				visible: data?.items.map(({ id }) => id) ?? [],
			}),
		},
	);

	const summaryState = mediaSummaryStateMapper<GroupSummaryResult<Summary>, Summary>(
		({ summary }) => summary,
	);

	const { Activity, ActivityTab, mapActivity, activityQuery } = defineMediaReviewActivityTab({
		kind,
		historyRecipe: recipes.historyRecipe,
		activityRecipe: recipes.activityRecipe,
	});

	const header = (summary: Summary, copy: MediaCopy): MediaSummaryHeaderDetail => {
		const { text } = copy;
		const status = groupProgressLabel(text, summary, members.verb);
		return {
			chips: [],
			identityDetail: undefined,
			links: mediaSourceLinks(copy, summary),
			facts: [mediaCountFact(text, summary.parts, members.unit, "layers-3")].filter(
				(fact) => fact !== undefined,
			),
			rail: {
				logActivity: undefined,
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

	const membersCopy = (text: MediaText): MediaCursorPagesCopy => ({
		empty: text("group.members-empty", { unit: members.unit }),
		error: (state) => mediaCursorPageError(text, { state, kind: members.unit }),
		loading: {
			title: text("group.members-loading", { unit: members.unit }),
			detail: text("group.members-loading-detail", { unit: members.unit }),
		},
	});

	function MembersTab(props: { readonly compact: boolean; readonly entityId: string }) {
		const text = useMediaMessages();
		return (
			<div className={clsx("flex flex-col", props.compact ? "gap-5 pt-6" : "gap-6 pt-8")}>
				<MediaCursorPages
					query={membersQuery}
					key={props.entityId}
					assets={memberAssets}
					copy={membersCopy(text)}
					input={{ entityId: props.entityId }}
					getPageInput={(input, after) => ({ ...input, after })}
					renderItems={(items) => {
						const batchAssets = memberAssets(items);
						return (
							<div>
								{items.map((item) => (
									<MemberRow
										key={item.id}
										entityId={item.id}
										compact={props.compact}
										data={{ ...item, batchAssets }}
										isInMediaLibrary={item.isInMediaLibrary}
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
		creditCopy === undefined || overview === undefined ? null : (
			<MediaCreditColumns
				copy={creditCopy}
				compact={compact}
				people={overview.people.items}
				companies={overview.companies.items}
				peopleAction={
					<MediaCreditsButton
						kind="people"
						aspect="square"
						compact={compact}
						query={peopleQuery}
						input={{ entityId }}
						title={creditCopy.people}
						safeAreaTop={safeAreaTop}
					/>
				}
				companiesAction={
					<MediaCreditsButton
						fit="contain"
						aspect="square"
						kind="companies"
						compact={compact}
						input={{ entityId }}
						query={companiesQuery}
						safeAreaTop={safeAreaTop}
						title={creditCopy.companies}
					/>
				}
			/>
		);

	function ScreenBody(props: {
		readonly compact: boolean;
		readonly members: ReactNode;
		readonly safeAreaTop: number;
		readonly refresh: () => void;
		readonly activity: ReactNode;
		readonly refreshOverview: () => void;
		readonly summaryRefreshStatus?: ReactNode;
		readonly overviewRefreshStatus?: ReactNode;
		readonly state: MediaSummaryState<Summary>;
		readonly settled: undefined | EntitySettleReason;
		readonly overview: MediaOverviewState<GroupOverview<Overview>>;
	}) {
		const text = useMediaMessages();
		return (
			<MediaDetailBody
				header={header}
				tabs={tabs(text)}
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
				artwork={{ aspect: descriptor.aspect }}
				summaryError={summaryState.summaryError}
				summaryRefreshStatus={props.summaryRefreshStatus}
				overviewRefreshStatus={props.overviewRefreshStatus}
				summaryUnavailable={summaryState.summaryUnavailable}
				overviewLoadingDetail={catalogMessage("group.overview-loading")}
				tabContent={{ members: props.members, activity: props.activity }}
				overviewNoticeTitle={creditCopy?.notice ?? catalogMessage("property.images")}
				overviewEmpty={{
					title: text("group.overview-empty-title"),
					detail: text("group.overview-empty-detail"),
				}}
			/>
		);
	}

	const DetailBody = (input: MediaDetailBodyInput<Summary, GroupOverview<Overview>>) => (
		<ScreenBody
			{...input}
			members={createElement(MembersTab, { compact: input.compact, entityId: input.entityId })}
			activity={createElement(ActivityTab, {
				compact: input.compact,
				entityId: input.entityId,
				safeAreaTop: input.safeAreaTop,
			})}
		/>
	);

	function Screen(props: EntityRendererProps) {
		const screen = {
			summaryQuery,
			Body: DetailBody,
			entityId: props.entityId,
			mapSummary: summaryState.mapSummary,
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
		const text = useMediaMessages();
		const progress = groupProgressLabel(text, data, members.verb);
		return (
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-ui text-[12px] text-text-muted">
				{mediaCountLabels(text, data.parts, members.unit).map((fact) => (
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
