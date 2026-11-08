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
	useRyot,
	useRyotInfiniteQuery,
	useRyotQuery,
	useRyotSchedule,
} from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import {
	Button,
	EmptyState,
	LoadMoreButton,
	resultsLayoutClasses,
	schemaSlugLabel,
	SearchField,
	Skeleton,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { fieldSyncState } from "@ryot-app/plugin-ui-sdk/sync";
import clsx from "clsx";
import { type ReactNode, useEffect, useEffectEvent, useState } from "react";

import {
	type CollectionRecommendation,
	collectionRecommendationSourcesRecipe,
	type CollectionRecommendationSourcesResult,
	collectionRecommendationsRecipe,
	type CollectionRecommendationsResult,
} from "../../shared/discovery-recipes";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { mediaArtworkClass, mediaAspectClass } from "../media/entity-presentation";
import { collectManagedAssetLocators } from "../media/image";
import { MediaLibraryTitle } from "../media/library-title";
import { ManagedAssetImage } from "../media/managed-assets";
import { MediaRefreshStatus, MediaStatusMessage } from "../media/primitives";
import { mediaPosterAsset } from "../media/summary-state";
import { mediaAspectOf } from "../schema-aspects";

const PAGE_SIZE = 30;
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
				collectionId: input,
				reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
			}),
		),
);

const recommendationsQuery = createRyotQuery<RecommendationsInput, CollectionRecommendationsResult>(
	({ input, client }) =>
		client.data.query(
			collectionRecommendationsRecipe({
				limit: PAGE_SIZE,
				after: input.after ?? undefined,
				collectionId: input.collectionId,
				reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
				...(input.searchText === "" ? {} : { searchText: input.searchText }),
			}),
		),
	{
		cancelOnUnmount: true,
		entityWatch: ({ data }) => ({ foreground: [], visible: data?.items.map(({ id }) => id) ?? [] }),
	},
);

const pluralize = (count: number, noun: string) =>
	`${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;

const unavailable = (
	<MediaStatusMessage
		title="Collection unavailable"
		detail="This collection was deleted or you no longer have access to it."
	/>
);

export default function CollectionRecommendationsPage() {
	const { collectionId } = usePluginParams();
	return collectionId === undefined || collectionId === "" ? (
		<PluginScreenFrame title="Recommendations">{unavailable}</PluginScreenFrame>
	) : (
		<CollectionRecommendationsScreen collectionId={collectionId} />
	);
}

function RecommendationsSkeleton() {
	return (
		<div role="status" aria-label="Loading recommendations" className={resultsLayoutClasses.grid}>
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

function CollectionRecommendationsScreen(props: { readonly collectionId: string }) {
	const { collectionId } = props;
	const { compact } = useRyotViewport();
	const sources = useRyotQuery(sourcesQuery, collectionId);
	const collection = sources.data;
	let body: ReactNode;
	if (collection === null) {
		body = unavailable;
	} else if (collection === undefined) {
		body = sources.isError ? (
			<MediaStatusMessage
				onRetry={sources.refetch}
				title="Unable to load recommendations"
				detail="This collection could not be loaded. Check your connection and try again."
			/>
		) : (
			<RecommendationsSkeleton />
		);
	} else {
		body = (
			<Recommendations compact={compact} collection={collection} collectionId={collectionId} />
		);
	}
	return (
		<PluginScreenFrame
			title="Recommendations"
			titleIcon={<AppIcon size={22} name="sparkles" />}
			meta={
				collection ? (
					<PluginLink
						to={{ kind: "entity", entityId: collection.id }}
						className="font-ui text-[13px] text-text-muted hover:text-text"
					>
						From {collection.name}
					</PluginLink>
				) : undefined
			}
		>
			<div className={clsx("@container flex flex-col", compact ? "gap-4" : "gap-5")}>{body}</div>
		</PluginScreenFrame>
	);
}

function RecommendationCard(props: {
	readonly compact: boolean;
	readonly item: CollectionRecommendation;
}) {
	const { item } = props;
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
			aria-label={`Open ${item.name}`}
			to={{ kind: "entity", entityId: item.id }}
			aria-description={item.isInMediaLibrary ? "In your library" : undefined}
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
					<span className="capitalize">{schemaSlugLabel(item.schemaSlug)}</span>
					{item.suggestedBy > 1 ? ` · Suggested by ${item.suggestedBy}` : null}
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
						Suggested by {pluralize(sourceCount, "title")} in this collection
					</p>
					<SearchField
						shortcut="/"
						value={draft}
						onChange={setDraft}
						className="h-9 sm:w-72"
						onSubmit={() => commit(draft)}
						label="Search recommendations"
						icon={<AppIcon size={15} name="search" />}
						clearIcon={<AppIcon name="x" size={14} />}
					/>
				</div>
			)}
			{sourceCount === 0 ? (
				<EmptyState
					title="No suggestions yet"
					icon={<AppIcon size={18} name="sparkles" />}
					description="None of the titles in this collection have provider suggestions. Add titles from a provider, or refresh a title to fetch its suggestions."
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

function RecommendationResults(props: {
	readonly compact: boolean;
	readonly searchText: string;
	readonly collectionId: string;
	readonly onClearSearch: () => void;
}) {
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
				title="Unable to load recommendations"
				detail="These recommendations could not be loaded. Check your connection and try again."
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
				title="Nothing new to recommend"
				icon={<AppIcon size={18} name="circle-check" />}
				description="Every title suggested by this collection is already in it."
			/>
		) : (
			<EmptyState
				icon={<AppIcon size={18} name="search" />}
				title={`No recommendations match “${props.searchText}”`}
				action={
					<Button variant="secondary" onClick={props.onClearSearch}>
						Clear search
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
				<ul aria-label="Recommendations" className={resultsLayoutClasses.grid}>
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
					title="Unable to load more recommendations"
					detail="The next recommendations could not be loaded. Check your connection and try again."
				/>
			) : null}
			{!result.hasNextPage || result.errorOperation === "append" ? null : (
				<LoadMoreButton
					label="Load more"
					disabled={result.isFetching}
					onClick={result.fetchNextPage}
					onVisible={result.fetchNextPage}
					isFetchingNextPage={result.isFetchingNextPage}
				/>
			)}
		</>
	);
}
