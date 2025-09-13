import { getQueryEngineField } from "@ryot/ts-utils/query-engine";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { FlatList, Image, Platform, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Box } from "@/components/ui/box";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { useApiClient } from "@/lib/api-client";
import { useResolvedImageUrls } from "@/lib/image";
import { entityHref } from "@/lib/navigation-data";

import type { QueryEngineEntityItem } from "../entity-detail/query-engine";
import { LoadMoreFooter, SavedViewHeader, ScreenState } from "./chrome";
import { useSavedViewLayout } from "./layout";
import {
	SAVED_VIEW_RUNTIME_FIELD_KEYS,
	type SavedViewLayout,
	createSavedViewRuntimeRequest,
	extractSavedViewImageEntries,
	flattenSavedViewPages,
	formatSavedViewFieldValue,
	getEntityId,
	isEntitySavedView,
} from "./runtime";
import { SavedViewTableResults } from "./table";

function formatVisibleValue(field: QueryEngineEntityItem[string] | undefined, fallback?: string) {
	const value = formatSavedViewFieldValue(field);
	if (value.kind === "text" && value.value.trim().length > 0) {
		return value.value;
	}
	return fallback ?? null;
}

function SavedViewCard(props: {
	imageUrl?: string;
	onPress: () => void;
	entityId: string | null;
	item: QueryEngineEntityItem;
}) {
	const eyebrow = formatVisibleValue(
		getQueryEngineField(props.item, SAVED_VIEW_RUNTIME_FIELD_KEYS.eyebrow),
	);
	const title = formatVisibleValue(
		getQueryEngineField(props.item, SAVED_VIEW_RUNTIME_FIELD_KEYS.title),
		"Untitled",
	);
	const primarySubtitle = formatVisibleValue(
		getQueryEngineField(props.item, SAVED_VIEW_RUNTIME_FIELD_KEYS.primarySubtitle),
	);
	const secondarySubtitle = formatVisibleValue(
		getQueryEngineField(props.item, SAVED_VIEW_RUNTIME_FIELD_KEYS.secondarySubtitle),
	);
	const callout = formatVisibleValue(
		getQueryEngineField(props.item, SAVED_VIEW_RUNTIME_FIELD_KEYS.callout),
	);

	return (
		<Pressable
			onPress={props.onPress}
			disabled={!props.entityId}
			className={clsx(
				"flex-1 rounded-3xl border border-border bg-card p-3",
				!props.entityId && "opacity-60",
			)}
		>
			{props.imageUrl ? (
				<Box className="overflow-hidden rounded-[18px] bg-stone-200" style={{ aspectRatio: 2 / 3 }}>
					<Image className="h-full w-full" resizeMode="cover" source={{ uri: props.imageUrl }} />
				</Box>
			) : null}
			{eyebrow ? (
				<Text className="mt-3 text-[10px] font-sans uppercase tracking-[2px] text-muted-foreground">
					{eyebrow}
				</Text>
			) : null}
			<Text
				numberOfLines={2}
				className="mt-1 text-[18px] leading-5.5 font-heading-semibold text-foreground"
			>
				{title}
			</Text>
			{primarySubtitle ? (
				<Text className="mt-1 text-[13px] leading-4.5 text-muted-foreground" numberOfLines={2}>
					{primarySubtitle}
				</Text>
			) : null}
			{secondarySubtitle ? (
				<Text className="mt-1 text-[13px] leading-4.5 text-muted-foreground" numberOfLines={2}>
					{secondarySubtitle}
				</Text>
			) : null}
			{callout ? (
				<Box className="mt-3 self-start rounded-full bg-stone-200 px-2.5 py-1">
					<Text className="text-[11px] font-sans-medium text-foreground" numberOfLines={1}>
						{callout}
					</Text>
				</Box>
			) : null}
		</Pressable>
	);
}

function SavedViewRow(props: {
	imageUrl?: string;
	onPress: () => void;
	entityId: string | null;
	item: QueryEngineEntityItem;
}) {
	const eyebrow = formatVisibleValue(
		getQueryEngineField(props.item, SAVED_VIEW_RUNTIME_FIELD_KEYS.eyebrow),
	);
	const title = formatVisibleValue(
		getQueryEngineField(props.item, SAVED_VIEW_RUNTIME_FIELD_KEYS.title),
		"Untitled",
	);
	const primarySubtitle = formatVisibleValue(
		getQueryEngineField(props.item, SAVED_VIEW_RUNTIME_FIELD_KEYS.primarySubtitle),
	);
	const secondarySubtitle = formatVisibleValue(
		getQueryEngineField(props.item, SAVED_VIEW_RUNTIME_FIELD_KEYS.secondarySubtitle),
	);
	const callout = formatVisibleValue(
		getQueryEngineField(props.item, SAVED_VIEW_RUNTIME_FIELD_KEYS.callout),
	);

	return (
		<Pressable
			onPress={props.onPress}
			disabled={!props.entityId}
			className={clsx(
				"rounded-[22px] border border-border bg-card p-3",
				!props.entityId && "opacity-60",
			)}
		>
			<Box className="flex-row gap-3">
				{props.imageUrl ? (
					<Box className="h-18 w-18 overflow-hidden rounded-[18px] bg-stone-200">
						<Image className="h-full w-full" resizeMode="cover" source={{ uri: props.imageUrl }} />
					</Box>
				) : null}
				<Box className="flex-1">
					{eyebrow ? (
						<Text className="text-[10px] font-sans uppercase tracking-[2px] text-muted-foreground">
							{eyebrow}
						</Text>
					) : null}
					<Text
						numberOfLines={2}
						className="mt-1 text-[17px] leading-5.25 font-heading-semibold text-foreground"
					>
						{title}
					</Text>
					{primarySubtitle ? (
						<Text numberOfLines={2} className="mt-1 text-[13px] leading-4.5 text-muted-foreground">
							{primarySubtitle}
						</Text>
					) : null}
					{secondarySubtitle ? (
						<Text numberOfLines={2} className="mt-1 text-[13px] leading-4.5 text-muted-foreground">
							{secondarySubtitle}
						</Text>
					) : null}
				</Box>
			</Box>
			{callout ? (
				<Box className="mt-3 self-start rounded-full bg-stone-200 px-2.5 py-1">
					<Text className="text-[11px] font-sans-medium text-foreground" numberOfLines={1}>
						{callout}
					</Text>
				</Box>
			) : null}
		</Pressable>
	);
}

function SavedViewResults(props: {
	viewName: string;
	totalCount: number;
	isFetching: boolean;
	hasNextPage: boolean;
	onLoadMore: () => void;
	layout: SavedViewLayout;
	isFetchingNextPage: boolean;
	rows: QueryEngineEntityItem[];
	loadMoreError?: string | null;
	imageUrlById: Map<string, string | undefined>;
	onLayoutChange: (layout: SavedViewLayout) => void;
}) {
	const router = useRouter();
	const isGrid = props.layout === "grid";

	if (isGrid && Platform.OS === "web") {
		return (
			<ScrollView
				scrollEventThrottle={400}
				showsVerticalScrollIndicator={false}
				contentContainerStyle={{
					gap: 12,
					paddingTop: 16,
					paddingBottom: 40,
					paddingHorizontal: 28,
				}}
				onScroll={({ nativeEvent }) => {
					const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
					if (
						layoutMeasurement.height + contentOffset.y >= contentSize.height - 200 &&
						props.hasNextPage &&
						!props.isFetchingNextPage
					) {
						props.onLoadMore();
					}
				}}
			>
				<Box className="mb-4">
					<SavedViewHeader
						layout={props.layout}
						name={props.viewName}
						count={props.totalCount}
						onLayoutChange={props.onLayoutChange}
						isLoadingMore={props.isFetching && props.rows.length === 0}
					/>
				</Box>
				{props.rows.length === 0 ? (
					props.isFetching ? (
						<Box className="rounded-[22px] border border-border bg-card px-4 py-5">
							<Text className="text-[14px] font-sans-medium text-foreground">Loading entries</Text>
							<Text className="mt-1 text-[13px] text-muted-foreground">
								Fetching the first page from the query engine.
							</Text>
						</Box>
					) : (
						<Box className="rounded-[22px] border border-border bg-card px-4 py-5">
							<Text className="text-[14px] font-sans-medium text-foreground">No entries found</Text>
							<Text className="mt-1 text-[13px] text-muted-foreground">
								This saved view did not return any results.
							</Text>
						</Box>
					)
				) : (
					<Box className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
						{props.rows.map((item, index) => {
							const entityId = getEntityId(item);
							const imageUrl = entityId
								? props.imageUrlById.get(`${entityId}:${SAVED_VIEW_RUNTIME_FIELD_KEYS.image}`)
								: undefined;
							return (
								<SavedViewCard
									item={item}
									entityId={entityId}
									imageUrl={imageUrl}
									key={entityId ?? `grid-${index}`}
									onPress={() => {
										if (entityId) {
											router.push(entityHref(entityId));
										}
									}}
								/>
							);
						})}
					</Box>
				)}
				<Box className="pt-2">
					<LoadMoreFooter
						onPress={props.onLoadMore}
						hasNextPage={props.hasNextPage}
						errorMessage={props.loadMoreError}
						isFetchingNextPage={props.isFetchingNextPage}
					/>
				</Box>
			</ScrollView>
		);
	}

	return (
		<FlatList
			data={props.rows}
			key={props.layout}
			numColumns={isGrid ? 2 : 1}
			onEndReachedThreshold={0.6}
			columnWrapperStyle={isGrid ? { gap: 12 } : undefined}
			keyExtractor={(item, index) => getEntityId(item) ?? `${props.layout}-${index}`}
			contentContainerStyle={{ gap: 12, paddingBottom: 40, paddingHorizontal: 28, paddingTop: 16 }}
			ListHeaderComponent={
				<Box className="mb-4">
					<SavedViewHeader
						layout={props.layout}
						name={props.viewName}
						count={props.totalCount}
						onLayoutChange={props.onLayoutChange}
						isLoadingMore={props.isFetching && props.rows.length === 0}
					/>
				</Box>
			}
			ListEmptyComponent={
				props.isFetching && props.rows.length === 0 ? (
					<Box className="rounded-[22px] border border-border bg-card px-4 py-5">
						<Text className="text-[14px] font-sans-medium text-foreground">Loading entries</Text>
						<Text className="mt-1 text-[13px] text-muted-foreground">
							Fetching the first page from the query engine.
						</Text>
					</Box>
				) : (
					<Box className="rounded-[22px] border border-border bg-card px-4 py-5">
						<Text className="text-[14px] font-sans-medium text-foreground">No entries found</Text>
						<Text className="mt-1 text-[13px] text-muted-foreground">
							This saved view did not return any results.
						</Text>
					</Box>
				)
			}
			ListFooterComponent={
				<Box className="pt-2">
					<LoadMoreFooter
						onPress={props.onLoadMore}
						hasNextPage={props.hasNextPage}
						errorMessage={props.loadMoreError}
						isFetchingNextPage={props.isFetchingNextPage}
					/>
				</Box>
			}
			onEndReached={() => {
				if (props.hasNextPage && !props.isFetchingNextPage) {
					props.onLoadMore();
				}
			}}
			renderItem={({ item }) => {
				const entityId = getEntityId(item);
				const imageUrl = entityId
					? props.imageUrlById.get(`${entityId}:${SAVED_VIEW_RUNTIME_FIELD_KEYS.image}`)
					: undefined;
				const onPress = () => {
					if (entityId) {
						router.push(entityHref(entityId));
					}
				};

				return isGrid ? (
					<SavedViewCard entityId={entityId} imageUrl={imageUrl} item={item} onPress={onPress} />
				) : (
					<SavedViewRow entityId={entityId} imageUrl={imageUrl} item={item} onPress={onPress} />
				);
			}}
			showsVerticalScrollIndicator={false}
		/>
	);
}

export function SavedViewScreen(props: { viewSlug: string }) {
	const apiClient = useApiClient();
	const insets = useSafeAreaInsets();
	const normalizedSlug = props.viewSlug.trim();
	const { layout, setLayout } = useSavedViewLayout(props.viewSlug);

	const viewQuery = useQuery({
		enabled: normalizedSlug.length > 0,
		queryKey: ["saved-view", normalizedSlug],
		queryFn: async () => {
			const response = await apiClient.GET("/saved-views/{viewSlug}", {
				params: { path: { viewSlug: normalizedSlug } },
			});
			if (response.error) {
				throw new Error("Failed to load saved view");
			}

			return response.data.data;
		},
	});

	const view = viewQuery.data;
	const supportedView = view && isEntitySavedView(view) ? view : null;

	const runtimeQuery = useInfiniteQuery({
		initialPageParam: 1,
		enabled: !!supportedView,
		queryKey: ["saved-view-runtime", normalizedSlug, layout, view?.updatedAt ?? null],
		queryFn: async ({ pageParam }) => {
			if (!supportedView) {
				throw new Error("Failed to load saved view results");
			}

			const response = await apiClient.POST("/query-engine/execute", {
				body: createSavedViewRuntimeRequest({
					layout,
					page: pageParam,
					view: supportedView,
				}),
			});

			if (response.error || response.data.mode !== "entities") {
				throw new Error("Failed to load saved view results");
			}

			return response.data;
		},
		getNextPageParam: (lastPage, pages) =>
			lastPage.data.meta.pagination.hasNextPage ? pages.length + 1 : undefined,
	});

	const rows = useMemo(
		() => flattenSavedViewPages(runtimeQuery.data?.pages ?? []),
		[runtimeQuery.data?.pages],
	);
	const totalCount = runtimeQuery.data?.pages[0]?.data.meta.pagination.total ?? 0;
	const imageEntries = useMemo(() => extractSavedViewImageEntries(rows), [rows]);
	const { imageUrlById } = useResolvedImageUrls(imageEntries);

	if (normalizedSlug.length === 0) {
		return (
			<ScreenState
				title="Saved view not found"
				description="The route did not include a saved view slug."
			/>
		);
	}

	if (viewQuery.isLoading) {
		return <ScreenState title="Loading saved view" description="Fetching saved view metadata." />;
	}

	if (viewQuery.isError) {
		return (
			<ScreenState
				actionLabel="Retry"
				title="Failed to load saved view"
				action={() => void viewQuery.refetch()}
				description="We could not load this saved view from the backend."
			/>
		);
	}

	if (!view) {
		return (
			<ScreenState title="Saved view not found" description="No saved view matched this slug." />
		);
	}

	if (!supportedView) {
		return (
			<ScreenState
				title="Saved view not supported"
				description="This saved view is not an entity view yet."
			/>
		);
	}

	if (runtimeQuery.isError && rows.length === 0) {
		return (
			<ScreenState
				actionLabel="Retry"
				title="Failed to load saved view entries"
				action={() => void runtimeQuery.refetch()}
				description="We could not load the saved view results from the query engine."
			/>
		);
	}

	return (
		<Box className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
			{layout === "table" ? (
				<SavedViewTableResults
					rows={rows}
					layout={layout}
					viewName={view.name}
					totalCount={totalCount}
					onLayoutChange={setLayout}
					imageUrlById={imageUrlById}
					isFetching={runtimeQuery.isFetching}
					hasNextPage={runtimeQuery.hasNextPage}
					onLoadMore={() => void runtimeQuery.fetchNextPage()}
					isFetchingNextPage={runtimeQuery.isFetchingNextPage}
					tableColumns={supportedView.displayConfiguration.table.columns}
					loadMoreError={runtimeQuery.isError ? "The next page could not be loaded." : null}
				/>
			) : (
				<SavedViewResults
					rows={rows}
					layout={layout}
					viewName={view.name}
					totalCount={totalCount}
					onLayoutChange={setLayout}
					imageUrlById={imageUrlById}
					isFetching={runtimeQuery.isFetching}
					hasNextPage={runtimeQuery.hasNextPage}
					onLoadMore={() => void runtimeQuery.fetchNextPage()}
					isFetchingNextPage={runtimeQuery.isFetchingNextPage}
					loadMoreError={runtimeQuery.isError ? "The next page could not be loaded." : null}
				/>
			)}
		</Box>
	);
}
