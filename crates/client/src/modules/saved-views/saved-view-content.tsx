import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import type { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import type { SavedViewRecord } from "@ryot-app/ryotql-recipes/saved-view-records";
import { useHotkey } from "@tanstack/react-hotkeys";
import clsx from "clsx";
import { useRef, type ReactNode } from "react";
import type { TextInput } from "react-native";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";
import { NavigationStatus } from "@/modules/navigation/navigation-status";
import { ProviderAddHost, useProviderAddFlow } from "@/modules/provider-add/add-flow-host";
import { usePreferredProvider } from "@/modules/provider-add/use-preferred-provider";
import { AppButton } from "@/modules/ui/button";
import { ManagedAssetHost } from "@/modules/ui/managed-asset-host";
import { AppLoadMore } from "@/modules/ui/pagination";
import {
	AppSearchField,
	type AppSearchState,
	useSearchFieldShortcut,
} from "@/modules/ui/search-field";
import { AppStatusState } from "@/modules/ui/status-state";

import { SavedViewFrame } from "./saved-view-frame";
import { SavedViewGrid } from "./saved-view-grid";
import { SavedViewLayoutSelector, useSavedViewLayout } from "./saved-view-layout-selector";
import { SavedViewList } from "./saved-view-list";
import { SavedViewResultCount } from "./saved-view-result-count";
import { SavedViewTable } from "./saved-view-table";
import {
	savedViewError,
	type SavedViewActiveData,
	type SavedViewError,
	type SavedViewResultState,
} from "./state";

const DESKTOP_HEADER_ONLY = Platform.OS === "web" ? "hidden md:flex" : "hidden";

function EmptyState(props: {
	name: string;
	onAdd?: () => void;
	entitySchemaSlug: EntitySchemaSlug | null;
}) {
	return (
		<AppStatusState
			titleSize="large"
			className="min-h-96"
			title={`${props.name} is empty`}
			icon={<AppIcon className="text-text-subtle" name="library" size={40} />}
			detail={
				props.entitySchemaSlug === null
					? "No items have been added to this view yet."
					: "Search online to add your first item."
			}
			action={
				props.onAdd ? (
					<AppButton
						variant="primary"
						label="Search online"
						onPress={props.onAdd}
						className="rounded-pill"
						leading={<AppIcon className="text-accent-ink" name="search" size={16} />}
					/>
				) : undefined
			}
		/>
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
		<AppStatusState
			titleSize="large"
			className="min-h-96"
			title={`No matches in ${props.name}`}
			detail={`Nothing in this view matches “${props.query}”.`}
			icon={<AppIcon className="text-text-subtle" name="search-x" size={36} />}
			action={
				props.onAdd && props.entitySchemaSlug ? (
					<SearchProviderAction
						query={props.query}
						onPress={props.onAdd}
						entitySchemaSlug={props.entitySchemaSlug}
					/>
				) : undefined
			}
		/>
	);
}

function SearchingState() {
	return (
		<AppStatusState
			className="min-h-96"
			detail="Searching..."
			icon={<ActivityIndicator accessibilityLabel="Searching saved view" />}
		/>
	);
}

export function SavedViewErrorState(props: SavedViewError & { onRetry?: () => void }) {
	return (
		<AppStatusState
			title={props.title}
			detail={props.detail}
			className="min-h-96"
			action={
				props.onRetry ? (
					<Pressable accessibilityRole="button" onPress={props.onRetry}>
						<Text className="font-ui-medium text-sm text-accent-text">Try again</Text>
					</Pressable>
				) : undefined
			}
		/>
	);
}

function SavedViewItems(props: {
	readonly state: SavedViewActiveData;
	readonly tableColumns: SavedViewRecord["layouts"]["table"]["columns"];
}) {
	if (props.state.layout === "grid") {
		return <SavedViewGrid items={props.state.data.items} />;
	}
	if (props.state.layout === "list") {
		return <SavedViewList items={props.state.data.items} />;
	}
	return <SavedViewTable items={props.state.data.items} columns={props.tableColumns} />;
}

function SavedViewWebActions(props: {
	readonly viewName: string;
	readonly viewSlug: string;
	readonly hasItems: boolean;
	readonly onAdd?: () => void;
	readonly search: AppSearchState;
}) {
	const onAdd = props.onAdd;
	const [layout, setLayout] = useSavedViewLayout(props.viewSlug);
	const searchInputRef = useRef<TextInput>(null);
	useSearchFieldShortcut(searchInputRef);
	useHotkey("A", () => onAdd?.(), { enabled: Boolean(onAdd), stopPropagation: false });
	return (
		<View className="hidden flex-row items-center gap-2.5 md:flex">
			<AppSearchField
				showShortcut
				name={props.viewName}
				search={props.search}
				inputRef={searchInputRef}
				className="h-8.5 w-60 rounded-md"
			/>
			<SavedViewLayoutSelector value={layout} onChange={setLayout} />
			<Pressable
				onPress={() => undefined}
				disabled={!props.hasItems}
				accessibilityRole="button"
				accessibilityLabel="Open filters"
				className={clsx(
					"h-8.5 flex-row items-center gap-2 rounded-md border border-border-strong bg-bg px-3",
					!props.hasItems && "opacity-50",
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
					<View className="ml-1 rounded border border-accent-ink px-1.5 py-0.5">
						<Text className="font-mono text-[11px] text-accent-ink">A</Text>
					</View>
				</Pressable>
			) : null}
		</View>
	);
}

function SavedViewDisplay(
	props: SavedViewActiveData & {
		readonly onAdd?: () => void;
		readonly loadMore: () => void;
		readonly search: AppSearchState;
		readonly isLoadingMore: boolean;
		readonly record: SavedViewRecord;
		readonly isTransitioning: boolean;
	},
) {
	const { items, pageInfo } = props.data;
	let content: ReactNode;
	if (items.length > 0) {
		content = (
			<>
				<SavedViewItems state={props} tableColumns={props.record.layouts.table.columns} />
				<AppLoadMore
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
	return content;
}

export function SavedViewResultContent(props: {
	readonly refresh: () => void;
	readonly loadMore: () => void;
	readonly search: AppSearchState;
	readonly isLoadingMore: boolean;
	readonly record: SavedViewRecord;
	readonly isLayoutChanging: boolean;
	readonly initialScrollOffset: number;
	readonly state: SavedViewResultState;
	readonly queryDocument: RyotQLDocument;
	readonly onScrollOffsetChange: (offset: number) => void;
}) {
	const providerAdd = useProviderAddFlow();
	const entitySchemaSlug = props.record.entitySchemaSlug;
	const readyState = props.state.status === "ready" ? props.state : undefined;
	const onAdd = readyState && entitySchemaSlug !== null ? providerAdd.open : undefined;
	const meta = readyState ? (
		<View className="flex-row items-center gap-2">
			<SavedViewResultCount
				textClassName="font-ui text-[13px]"
				queryDocument={props.queryDocument}
				loaded={readyState.data.items.length}
				hasMore={readyState.data.pageInfo.hasMore}
			/>
			{props.isLayoutChanging ? (
				<ActivityIndicator size="small" accessibilityLabel="Loading saved view layout" />
			) : null}
		</View>
	) : undefined;
	let content: ReactNode;
	if (props.state.status === "ready") {
		const propReadyState = props.state;
		content = (
			<ManagedAssetHost label="saved-view" assets={propReadyState.assets}>
				<SavedViewDisplay
					{...propReadyState}
					onAdd={onAdd}
					record={props.record}
					search={props.search}
					loadMore={props.loadMore}
					isLoadingMore={props.isLoadingMore}
					isTransitioning={props.isLayoutChanging || props.search.isSearching}
				/>
			</ManagedAssetHost>
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
							{readyState ? (
								<SavedViewResultCount
									queryDocument={props.queryDocument}
									loaded={readyState.data.items.length}
									hasMore={readyState.data.pageInfo.hasMore}
									textClassName="font-ui text-xs md:text-sm"
								/>
							) : null}
						</View>
						<SavedViewWebActions
							onAdd={onAdd}
							search={props.search}
							viewName={props.record.name}
							viewSlug={props.record.slug}
							hasItems={Boolean(readyState?.data.items.length)}
						/>
					</View>
					{content}
				</View>
			</SavedViewFrame>
			{onAdd && entitySchemaSlug !== null ? (
				<ProviderAddHost
					onImported={props.refresh}
					isOpen={providerAdd.isOpen}
					onClose={providerAdd.close}
					initialQuery={props.search.query}
					entitySchemaSlug={entitySchemaSlug}
				/>
			) : null}
		</>
	);
}
