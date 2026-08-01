import type { SavedViewRecord } from "@ryot/ryotql-recipes/saved-view-records";
import clsx from "clsx";
import { Platform, Pressable, Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";

import { savedViewResultCount } from "./result-count";
import { SavedViewFrame } from "./saved-view-frame";
import { SavedViewGrid } from "./saved-view-grid";
import { SavedViewLayoutSelector } from "./saved-view-layout-selector";
import { SavedViewList } from "./saved-view-list";
import { SavedViewPagination } from "./saved-view-pagination";
import { SavedViewTable } from "./saved-view-table";
import type { SavedViewActiveData, SavedViewResultState } from "./state";
import { SavedViewRuntime } from "./use-saved-view";

const DESKTOP_HEADER_ONLY = Platform.OS === "web" ? "hidden md:flex" : "hidden";

function EmptyState(props: { name: string }) {
	return (
		<View className="min-h-96 items-center justify-center gap-3 px-6">
			<AppIcon className="text-text-subtle" name="library" size={40} />
			<Text className="text-center font-ui-semibold text-xl text-text">
				No items in {props.name}
			</Text>
			<Text className="text-center font-ui text-sm text-text-muted">
				This saved view has no results.
			</Text>
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
	userId: string;
	viewName: string;
	viewSlug: string;
	serverUrl: string;
}) {
	return (
		<View className="hidden flex-row items-center gap-2.5 md:flex">
			<Pressable
				onPress={() => undefined}
				accessibilityRole="button"
				accessibilityLabel={`Search ${props.viewName}`}
				className="h-8.5 w-60 flex-row items-center gap-2 rounded-md border border-border-strong bg-bg px-2.5"
			>
				<AppIcon className="text-text-muted" name="search" size={15} />
				<Text numberOfLines={1} className="min-w-0 flex-1 font-ui text-[13px] text-text-muted">
					Search {props.viewName}
				</Text>
				<View className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5">
					<Text className="font-mono text-[11px] text-text-subtle">/</Text>
				</View>
			</Pressable>
			<SavedViewLayoutSelector
				userId={props.userId}
				viewSlug={props.viewSlug}
				serverUrl={props.serverUrl}
			/>
			<Pressable
				onPress={() => undefined}
				accessibilityRole="button"
				accessibilityLabel="Open filters"
				className="h-8.5 flex-row items-center gap-2 rounded-md border border-border-strong bg-bg px-3"
			>
				<AppIcon className="text-text-muted" name="sliders-horizontal" size={15} />
				<Text className="font-ui text-[13px] text-text">Filters</Text>
				<View className="rounded-pill bg-accent-soft px-1.5 py-px">
					<Text className="font-ui text-[11px] text-accent-text">3</Text>
				</View>
			</Pressable>
			<Pressable
				onPress={() => undefined}
				accessibilityRole="button"
				accessibilityLabel="Add to this view"
				className="h-8.5 flex-row items-center gap-2 rounded-md bg-accent px-3.5"
			>
				<AppIcon className="text-accent-ink" name="plus" size={15} />
				<Text className="font-ui-semibold text-[13px] text-accent-ink">Add</Text>
			</Pressable>
		</View>
	);
}

function SavedViewDisplay(
	props: SavedViewActiveData & {
		readonly userId: string;
		readonly serverUrl: string;
		readonly loadMore: () => void;
		readonly isLoadingMore: boolean;
		readonly record: SavedViewRecord;
		readonly managedUrls: ReadonlyMap<string, string>;
	},
) {
	const { items, pageInfo } = props.data;
	return (
		<SavedViewFrame
			viewSlug={props.record.slug}
			title={{
				loaded: items.length,
				hasMore: pageInfo.hasMore,
				icon: props.record.icon,
				name: props.record.name,
			}}
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
						<Text className="font-ui text-xs text-text-muted md:text-sm">
							{savedViewResultCount(items.length, pageInfo.hasMore)}
						</Text>
					</View>
					<SavedViewWebActions
						userId={props.userId}
						serverUrl={props.serverUrl}
						viewName={props.record.name}
						viewSlug={props.record.slug}
					/>
				</View>

				{items.length === 0 ? (
					<EmptyState name={props.record.name} />
				) : (
					<>
						<SavedViewItems {...props} />
						<SavedViewPagination
							loaded={items.length}
							name={props.record.name}
							hasMore={pageInfo.hasMore}
							onLoadMore={props.loadMore}
							isLoading={props.isLoadingMore}
						/>
					</>
				)}
			</View>
		</SavedViewFrame>
	);
}

export function SavedViewReadyContent(props: {
	readonly userId: string;
	readonly serverUrl: string;
	readonly refresh: () => void;
	readonly loadMore: () => void;
	readonly isLoadingMore: boolean;
	readonly record: SavedViewRecord;
	readonly state: Extract<SavedViewResultState, { status: "ready" }>;
}) {
	return (
		<SavedViewRuntime
			assets={props.state.assets}
			scope={{ userId: props.userId, serverUrl: props.serverUrl }}
		>
			{(assets) => <SavedViewDisplay {...props} {...props.state} managedUrls={assets.urls} />}
		</SavedViewRuntime>
	);
}
