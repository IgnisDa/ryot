import {
	PluginLink,
	usePluginParams,
	usePluginSearch,
	useRyotViewport,
} from "@ryot-app/plugin-client-sdk/plugin";
import {
	createRyotQuery,
	ManagedAssetProvider,
	nextPageCursor,
	useEntitlement,
	useEntitySchemaName,
	usePluginIdentity,
	useRyot,
	useRyotInfiniteQuery,
	useRyotQuery,
	useRyotSchedule,
} from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import {
	Button,
	EmptyState,
	EntitlementNotice,
	LoadMoreButton,
	resultsLayoutClasses,
	SearchField,
	Skeleton,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { fieldSyncState } from "@ryot-app/plugin-ui-sdk/sync";
import clsx from "clsx";
import { type ReactNode, useEffect, useEffectEvent, useState } from "react";

import {
	COLLECTION_RECOMMENDATION_PAGE_SIZE,
	type CollectionRecommendation,
	collectionRecommendationSourcesRecipe,
	type CollectionRecommendationSourcesResult,
	collectionRecommendationsQuery,
	collectionRecommendationsRecipe,
	type CollectionRecommendationsResult,
} from "../../shared/discovery-recipes";
import { declaredQuerySource, PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { mediaArtworkClass, mediaAspectClass } from "../media/entity-presentation";
import { collectManagedAssetLocators } from "../media/image";
import { MediaLibraryTitle } from "../media/library-title";
import { ManagedAssetImage } from "../media/managed-assets";
import { MediaRefreshStatus, MediaStatusMessage } from "../media/primitives";
import { mediaPosterAsset } from "../media/summary-state";
import { useMediaMessageBuilder, useMediaMessages } from "../messages";
import { mediaAspectOf } from "../schema-aspects";

const SEARCH_PARAM = "search";

type RecommendationsInput = {
	readonly searchText: string;
	readonly collectionId: string;
	readonly after: null | string;
};

const sourcesQuery = createRyotQuery<string, CollectionRecommendationSourcesResult>(
	({ input, client }) =>
		client.data.query(
			collectionRecommendationSourcesRecipe({
				reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
			}),
			{ collectionId: input },
		),
);

const recommendationsQuery = createRyotQuery<RecommendationsInput, CollectionRecommendationsResult>(
	({ input, client }) =>
		client.data.queryDeclared(
			collectionRecommendationsRecipe({ reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }),
			declaredQuerySource(collectionRecommendationsQuery),
			{ collectionId: input.collectionId, searchText: input.searchText.trim() },
			{
				pages: {
					recommendations: {
						after: input.after ?? undefined,
						limit: COLLECTION_RECOMMENDATION_PAGE_SIZE,
					},
				},
			},
		),
	{
		cancelOnUnmount: true,
		entityWatch: ({ data }) => ({ foreground: [], visible: data?.items.map(({ id }) => id) ?? [] }),
	},
);

export default function CollectionRecommendationsPage() {
	const { collectionId } = usePluginParams();
	const message = useMediaMessageBuilder();
	return collectionId === undefined || collectionId === "" ? (
		<PluginScreenFrame title={message("collection-page.recommendations.label")}>
			<Unavailable />
		</PluginScreenFrame>
	) : (
		<CollectionRecommendationsScreen collectionId={collectionId} />
	);
}

function Unavailable() {
	const text = useMediaMessages();
	return (
		<MediaStatusMessage
			title={text("recommendations.unavailable-title")}
			detail={text("recommendations.unavailable-detail")}
		/>
	);
}

function RecommendationsSkeleton() {
	const text = useMediaMessages();
	return (
		<div
			role="status"
			className={resultsLayoutClasses.grid}
			aria-label={text("recommendations.loading")}
		>
			{Array.from({ length: 8 }, (_, index) => (
				<div key={index} className="flex flex-col gap-2">
					<Skeleton className={clsx("w-full rounded-md", mediaAspectClass("poster"))} />
					<Skeleton className="h-3.5 w-3/4" />
					<Skeleton className="h-3 w-1/2" />
				</div>
			))}
		</div>
	);
}

function RecommendationCard(props: {
	readonly compact: boolean;
	readonly item: CollectionRecommendation;
}) {
	const { item } = props;
	const text = useMediaMessages();
	const schemaName = useEntitySchemaName();
	const { pluginId } = usePluginIdentity(PLUGIN_PACKAGE_ID);
	const art = mediaPosterAsset(item);
	const aspect = mediaAspectOf(item.schemaSlug);
	const image = (
		<ManagedAssetImage
			asset={art}
			monogram={item.name}
			state={fieldSyncState(art, item)}
			className={clsx(
				"shadow-sm transition-transform duration-150 group-hover:-translate-y-0.5 motion-reduce:transition-none",
				mediaArtworkClass({ aspect, layout: "grid", compact: props.compact }),
			)}
		/>
	);
	return (
		<PluginLink
			to={{ kind: "entity", entityId: item.id }}
			aria-label={text("common.open-named", { name: item.name })}
			aria-description={item.isInMediaLibrary ? text("library.in-library") : undefined}
			className={clsx(
				"group flex min-w-0 flex-col rounded-md focus-visible:outline-2 focus-visible:outline-accent",
				props.compact ? "gap-2.5" : "gap-3",
			)}
		>
			{aspect === "poster" ? (
				image
			) : (
				<div className={clsx("flex w-full items-end", mediaAspectClass("poster"))}>{image}</div>
			)}
			<span className="flex min-w-0 flex-col gap-1.5">
				<MediaLibraryTitle
					name={item.name}
					isInMediaLibrary={item.isInMediaLibrary}
					className="line-clamp-2 font-display leading-5 font-semibold"
				/>
				<span className="line-clamp-1 text-xs text-text-muted">
					<span>{schemaName({ ownerPluginId: pluginId, entitySchemaSlug: item.schemaSlug })}</span>
					{item.suggestedBy > 1
						? text("recommendations.suggested-by", { count: item.suggestedBy })
						: null}
				</span>
			</span>
		</PluginLink>
	);
}

function Recommendations(props: {
	readonly compact: boolean;
	readonly collectionId: string;
	readonly collection: NonNullable<CollectionRecommendationSourcesResult>;
}) {
	const text = useMediaMessages();
	const ryot = useRyot();
	const schedule = useRyotSchedule();
	const searchText = usePluginSearch().get(SEARCH_PARAM)?.trim() ?? "";
	const [draft, setDraft] = useState(searchText);
	const commit = (value: string) => {
		const next = value.trim();
		if (next !== searchText) {
			ryot.navigation.pageSearch.replace({ [SEARCH_PARAM]: next === "" ? null : next });
		}
	};
	const commitDraft = useEffectEvent(commit);
	useEffect(() => schedule.after(300, () => commitDraft(draft)), [draft, schedule]);
	const { sourceCount } = props.collection;
	return (
		<>
			{sourceCount === 0 ? null : (
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<p className="font-ui text-[13px] text-text-muted">
						{text("recommendations.sources", { count: sourceCount })}
					</p>
					<SearchField
						shortcut="/"
						value={draft}
						onChange={setDraft}
						className="h-9 sm:w-72"
						onSubmit={() => commit(draft)}
						label={text("recommendations.search")}
						icon={<AppIcon size={15} name="search" />}
						clearIcon={<AppIcon name="x" size={14} />}
					/>
				</div>
			)}
			{sourceCount === 0 ? (
				<EmptyState
					title={text("recommendations.none-title")}
					icon={<AppIcon size={18} name="sparkles" />}
					description={text("recommendations.none-description")}
				/>
			) : (
				<RecommendationResults
					compact={props.compact}
					searchText={searchText}
					collectionId={props.collectionId}
					onClearSearch={() => {
						setDraft("");
						commit("");
					}}
				/>
			)}
		</>
	);
}

function CollectionRecommendationsScreen(props: { readonly collectionId: string }) {
	const { collectionId } = props;
	const { compact } = useRyotViewport();
	const text = useMediaMessages();
	const message = useMediaMessageBuilder();
	const sources = useRyotQuery(sourcesQuery, collectionId);
	const pro = useEntitlement("pro");
	const collection = sources.data;
	let body: ReactNode;
	if (collection === null) {
		body = <Unavailable />;
	} else if (collection === undefined) {
		body = sources.isError ? (
			<MediaStatusMessage
				onRetry={sources.refetch}
				title={text("recommendations.error-title")}
				detail={text("recommendations.error-collection")}
			/>
		) : (
			<RecommendationsSkeleton />
		);
	} else if (pro.granted) {
		body = (
			<Recommendations compact={compact} collection={collection} collectionId={collectionId} />
		);
	} else if (pro.data !== undefined) {
		body = (
			<EntitlementNotice
				entitlement="pro"
				icon={<AppIcon size={16} name="sparkles" />}
				detail={text("recommendations.pro-required")}
			/>
		);
	} else {
		body = pro.isError ? (
			<MediaStatusMessage
				onRetry={pro.refetch}
				title={text("recommendations.error-title")}
				detail={text("recommendations.error-account")}
			/>
		) : (
			<RecommendationsSkeleton />
		);
	}
	return (
		<PluginScreenFrame
			titleIcon={<AppIcon size={22} name="sparkles" />}
			title={message("collection-page.recommendations.label")}
			meta={
				collection ? (
					<PluginLink
						to={{ kind: "entity", entityId: collection.id }}
						className="font-ui text-[13px] text-text-muted hover:text-text"
					>
						{text("recommendations.from", { name: collection.name })}
					</PluginLink>
				) : undefined
			}
		>
			<div className={clsx("@container flex flex-col", compact ? "gap-4" : "gap-5")}>{body}</div>
		</PluginScreenFrame>
	);
}

function RecommendationResults(props: {
	readonly compact: boolean;
	readonly searchText: string;
	readonly collectionId: string;
	readonly onClearSearch: () => void;
}) {
	const text = useMediaMessages();
	const result = useRyotInfiniteQuery(
		recommendationsQuery,
		{ searchText: props.searchText, collectionId: props.collectionId },
		{
			initialPageParam: null,
			getNextPageParam: nextPageCursor,
			getPageInput: (input, after: null | string) => ({ ...input, after }),
		},
	);
	if (result.pages.length === 0 && result.isError) {
		return (
			<MediaStatusMessage
				onRetry={result.retry}
				title={text("recommendations.error-title")}
				detail={text("recommendations.error-list")}
			/>
		);
	}
	if (result.pages.length === 0) {
		return <RecommendationsSkeleton />;
	}
	const items = result.pages.flatMap((page) => page.items);
	if (items.length === 0) {
		return props.searchText === "" ? (
			<EmptyState
				title={text("recommendations.nothing-title")}
				icon={<AppIcon size={18} name="circle-check" />}
				description={text("recommendations.nothing-description")}
			/>
		) : (
			<EmptyState
				icon={<AppIcon size={18} name="search" />}
				title={text("recommendations.no-match", { search: props.searchText })}
				action={
					<Button variant="secondary" onClick={props.onClearSearch}>
						{text("recommendations.clear-search")}
					</Button>
				}
			/>
		);
	}
	return (
		<>
			{result.errorOperation === "refresh" ? <MediaRefreshStatus result={result} /> : null}
			<ManagedAssetProvider
				assets={collectManagedAssetLocators(items.map((item) => mediaPosterAsset(item)))}
			>
				<ul
					className={resultsLayoutClasses.grid}
					aria-label={text("collection-page.recommendations.label")}
				>
					{items.map((item) => (
						<li key={item.id} className="min-w-0">
							<RecommendationCard item={item} compact={props.compact} />
						</li>
					))}
				</ul>
			</ManagedAssetProvider>
			{result.errorOperation === "append" && result.isError ? (
				<MediaStatusMessage
					onRetry={result.retry}
					detail={text("recommendations.error-more")}
					title={text("recommendations.error-more-title")}
				/>
			) : null}
			{!result.hasNextPage || result.errorOperation === "append" ? null : (
				<LoadMoreButton
					disabled={result.isFetching}
					onClick={result.fetchNextPage}
					onVisible={result.fetchNextPage}
					isFetchingNextPage={result.isFetchingNextPage}
				/>
			)}
		</>
	);
}
