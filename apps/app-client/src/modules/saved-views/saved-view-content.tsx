import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import type { EntitySchemaSlug } from "@ryot/contract/schema/brands";
import type { SavedViewRecord } from "@ryot/ryotql-recipes/saved-view-records";
import clsx from "clsx";
import { useRef, type ReactNode } from "react";
import type { TextInput } from "react-native";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";
import { NavigationStatus } from "@/modules/navigation/navigation-status";
import { ProviderAddHost, useProviderAddFlow } from "@/modules/provider-add/add-flow-host";
import { usePreferredProvider } from "@/modules/provider-add/use-preferred-provider";

import { SavedViewFrame } from "./saved-view-frame";
import { SavedViewGrid } from "./saved-view-grid";
import { SavedViewLayoutSelector, useSavedViewLayout } from "./saved-view-layout-selector";
import { SavedViewList } from "./saved-view-list";
import { SavedViewPagination } from "./saved-view-pagination";
import { SavedViewResultCount } from "./saved-view-result-count";
import {
	SavedViewSearchField,
	type SavedViewSearch,
	useSavedViewSearchShortcut,
} from "./saved-view-search";
import { SavedViewTable } from "./saved-view-table";
import {
	savedViewError,
	type SavedViewActiveData,
	type SavedViewError,
	type SavedViewResultState,
} from "./state";
import { SavedViewRuntime } from "./use-saved-view";

const DESKTOP_HEADER_ONLY = Platform.OS === "web" ? "hidden md:flex" : "hidden";

function EmptyState(props: {
	name: string;
	onAdd?: () => void;
	entitySchemaSlug: EntitySchemaSlug | null;
}) {
	return (
		<View className="min-h-96 items-center justify-center gap-3 px-6">
			<AppIcon className="text-text-subtle" name="library" size={40} />
			<Text className="text-center font-ui-semibold text-xl text-text">{props.name} is empty</Text>
			<Text className="text-center font-ui text-sm text-text-muted">
				{props.entitySchemaSlug === null
					? "No items have been added to this view yet."
					: "Search online to add your first item."}
			</Text>
			{props.onAdd ? (
				<Pressable
					onPress={props.onAdd}
					accessibilityRole="button"
					className="flex-row items-center gap-2 rounded-pill bg-accent px-4 py-2.5"
				>
					<AppIcon className="text-accent-ink" name="search" size={16} />
					<Text className="font-ui-semibold text-accent-ink">Search online</Text>
				</Pressable>
			) : null}
		</View>
	);
}

function SearchProviderAction(props: {
	query: string;
	onPress: () => void;
	entitySchemaSlug: EntitySchemaSlug;
}) {
	const provider = usePreferredProvider(props.entitySchemaSlug);
	if (!provider) {
		return null;
	}
	return (
		<View className="w-full max-w-md items-center gap-2">
			<Pressable
				onPress={props.onPress}
				accessibilityRole="button"
				className="w-full flex-row items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2.5"
			>
				<AppIcon className="text-accent-text" name="globe" size={16} />
				<Text numberOfLines={1} className="min-w-0 flex-1 font-ui-medium text-sm text-text">
					Search {provider.providerName} for “{props.query}”
				</Text>
				<AppIcon className="text-text-subtle" name="arrow-right" size={15} />
			</Pressable>
			<Text className="hidden text-center font-ui text-xs text-text-subtle md:flex">
				Opens online search. Results come from one provider and get added to your library.
			</Text>
		</View>
	);
}

function SearchEmptyState(props: {
	name: string;
	query: string;
	onAdd?: () => void;
	entitySchemaSlug: EntitySchemaSlug | null;
}) {
	return (
		<View className="min-h-96 items-center justify-center gap-3 px-6">
			<AppIcon className="text-text-subtle" name="search-x" size={36} />
			<Text className="text-center font-ui-semibold text-xl text-text">
				No matches in {props.name}
			</Text>
			<Text className="text-center font-ui text-sm text-text-muted">
				Nothing in this view matches “{props.query}”.
			</Text>
			{props.onAdd && props.entitySchemaSlug ? (
				<SearchProviderAction
					query={props.query}
					onPress={props.onAdd}
					entitySchemaSlug={props.entitySchemaSlug}
				/>
			) : null}
		</View>
	);
}

function SearchingState() {
	return (
		<View className="min-h-96 items-center justify-center gap-3 px-6">
			<ActivityIndicator accessibilityLabel="Searching saved view" />
			<Text className="font-ui text-sm text-text-muted">Searching...</Text>
		</View>
	);
}

export function SavedViewErrorState(props: SavedViewError & { onRetry?: () => void }) {
	return (
		<View className="min-h-96 items-center justify-center gap-3 px-6">
			<Text className="font-ui-medium text-base text-text">{props.title}</Text>
			<Text className="max-w-xl text-center font-ui text-sm text-text-muted">{props.detail}</Text>
			{props.onRetry ? (
				<Pressable accessibilityRole="button" onPress={props.onRetry}>
					<Text className="font-ui-medium text-sm text-accent-text">Try again</Text>
				</Pressable>
			) : null}
		</View>
	);
}

function SavedViewItems(props: SavedViewActiveData & { managedUrls: ReadonlyMap<string, string> }) {
	if (props.layout === "grid") {
		return <SavedViewGrid items={props.data.items} managedUrls={props.managedUrls} />;
	}
	if (props.layout === "list") {
		return <SavedViewList items={props.data.items} managedUrls={props.managedUrls} />;
	}
	return <SavedViewTable items={props.data.items} managedUrls={props.managedUrls} />;
}

function SavedViewWebActions(props: {
	readonly isEmpty: boolean;
	readonly viewName: string;
	readonly viewSlug: string;
	readonly onAdd?: () => void;
	readonly search: SavedViewSearch;
}) {
	const [layout, setLayout] = useSavedViewLayout(props.viewSlug);
	const searchInputRef = useRef<TextInput>(null);
	const isUnavailable = props.isEmpty && props.search.query === "";
	useSavedViewSearchShortcut(searchInputRef, !isUnavailable);
	return (
		<View className="hidden flex-row items-center gap-2.5 md:flex">
			<SavedViewSearchField
				showShortcut
				name={props.viewName}
				search={props.search}
				disabled={isUnavailable}
				inputRef={searchInputRef}
				className="h-8.5 w-60 rounded-md"
			/>
			<SavedViewLayoutSelector value={layout} onChange={setLayout} />
			<Pressable
				disabled={props.isEmpty}
				onPress={() => undefined}
				accessibilityRole="button"
				accessibilityLabel="Open filters"
				className={clsx(
					"h-8.5 flex-row items-center gap-2 rounded-md border border-border-strong bg-bg px-3",
					props.isEmpty && "opacity-50",
				)}
			>
				<AppIcon className="text-text-muted" name="sliders-horizontal" size={15} />
				<Text className="font-ui text-[13px] text-text">Filters</Text>
				<View className="rounded-pill bg-accent-soft px-1.5 py-px">
					<Text className="font-ui text-[11px] text-accent-text">0</Text>
				</View>
			</Pressable>
			{props.onAdd ? (
				<Pressable
					onPress={props.onAdd}
					accessibilityRole="button"
					accessibilityLabel="Add to this view"
					className="h-8.5 flex-row items-center gap-2 rounded-md bg-accent px-3.5"
				>
					<AppIcon className="text-accent-ink" name="plus" size={15} />
					<Text className="font-ui-semibold text-[13px] text-accent-ink">Add</Text>
				</Pressable>
			) : null}
		</View>
	);
}

function SavedViewDisplay(
	props: SavedViewActiveData & {
		readonly onAdd?: () => void;
		readonly loadMore: () => void;
		readonly isLoadingMore: boolean;
		readonly record: SavedViewRecord;
		readonly search: SavedViewSearch;
		readonly isTransitioning: boolean;
		readonly queryDocument: RyotQLDocument;
		readonly managedUrls: ReadonlyMap<string, string>;
	},
) {
	const { items, pageInfo } = props.data;
	let content: ReactNode;
	if (items.length > 0) {
		content = (
			<>
				<SavedViewItems {...props} />
				<SavedViewPagination
					loaded={items.length}
					name={props.record.name}
					onLoadMore={props.loadMore}
					isLoading={props.isLoadingMore}
					hasMore={pageInfo.hasMore && !props.isTransitioning}
				/>
			</>
		);
	} else if (props.search.isSearching) {
		content = <SearchingState />;
	} else if (props.search.query !== "") {
		content = (
			<SearchEmptyState
				onAdd={props.onAdd}
				name={props.record.name}
				query={props.search.query}
				entitySchemaSlug={props.record.entitySchemaSlug}
			/>
		);
	} else {
		content = (
			<EmptyState
				onAdd={props.onAdd}
				name={props.record.name}
				entitySchemaSlug={props.record.entitySchemaSlug}
			/>
		);
	}
	return (
		<View className="w-full gap-5">
			<View
				className={clsx(
					"gap-3 md:h-15 md:flex-row md:items-start md:justify-between md:gap-6",
					DESKTOP_HEADER_ONLY,
				)}
			>
				<View className="min-w-0 gap-1">
					<View className="flex-row items-center gap-2.5">
						<AppIcon size={20} name={props.record.icon} className="shrink-0 text-text-muted" />
						<Text
							numberOfLines={1}
							className="min-w-0 flex-1 font-ui-semibold text-xl text-text md:font-display md:text-3xl"
						>
							{props.record.name}
						</Text>
					</View>
					<SavedViewResultCount
						loaded={items.length}
						hasMore={pageInfo.hasMore}
						queryDocument={props.queryDocument}
						textClassName="font-ui text-xs md:text-sm"
					/>
				</View>
				<SavedViewWebActions
					onAdd={props.onAdd}
					search={props.search}
					isEmpty={items.length === 0}
					viewName={props.record.name}
					viewSlug={props.record.slug}
				/>
			</View>

			{content}
		</View>
	);
}

export function SavedViewResultContent(props: {
	readonly refresh: () => void;
	readonly loadMore: () => void;
	readonly isLoadingMore: boolean;
	readonly record: SavedViewRecord;
	readonly search: SavedViewSearch;
	readonly isLayoutChanging: boolean;
	readonly initialScrollOffset: number;
	readonly state: SavedViewResultState;
	readonly queryDocument: RyotQLDocument;
	readonly onScrollOffsetChange: (offset: number) => void;
}) {
	const providerAdd = useProviderAddFlow();
	const entitySchemaSlug = props.record.entitySchemaSlug;
	const onAdd =
		props.state.status === "ready" && entitySchemaSlug !== null ? providerAdd.open : undefined;
	const meta =
		props.state.status === "ready" ? (
			<View className="flex-row items-center gap-2">
				<SavedViewResultCount
					textClassName="font-ui text-[13px]"
					queryDocument={props.queryDocument}
					loaded={props.state.data.items.length}
					hasMore={props.state.data.pageInfo.hasMore}
				/>
				{props.isLayoutChanging ? (
					<ActivityIndicator size="small" accessibilityLabel="Loading saved view layout" />
				) : null}
			</View>
		) : undefined;
	let content: ReactNode;
	if (props.state.status === "ready") {
		const readyState = props.state;
		content = (
			<SavedViewRuntime assets={readyState.assets}>
				{(assets) => (
					<SavedViewDisplay
						{...readyState}
						onAdd={onAdd}
						record={props.record}
						search={props.search}
						loadMore={props.loadMore}
						managedUrls={assets.urls}
						queryDocument={props.queryDocument}
						isLoadingMore={props.isLoadingMore}
						isTransitioning={props.isLayoutChanging || props.search.isSearching}
					/>
				)}
			</SavedViewRuntime>
		);
	} else if (props.state.status === "loading") {
		content = <NavigationStatus title="Loading saved view..." />;
	} else {
		content = <SavedViewErrorState {...savedViewError(props.state)} onRetry={props.refresh} />;
	}
	return (
		<>
			<SavedViewFrame
				meta={meta}
				onAdd={onAdd}
				search={props.search}
				title={props.record.name}
				viewSlug={props.record.slug}
				initialScrollOffset={props.initialScrollOffset}
				onScrollOffsetChange={props.onScrollOffsetChange}
			>
				{content}
			</SavedViewFrame>
			{onAdd && entitySchemaSlug !== null ? (
				<ProviderAddHost
					onImported={props.refresh}
					initialQuery={props.search.query}
					entitySchemaSlug={entitySchemaSlug}
				/>
			) : null}
		</>
	);
}
