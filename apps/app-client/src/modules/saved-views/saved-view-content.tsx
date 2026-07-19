import type { EntitySchemaSlug } from "@ryot/contract/schema/brands";
import type { SavedViewRecord } from "@ryot/ryotql-recipes/saved-view-records";
import clsx from "clsx";
import { Platform, Pressable, Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";
import { ProviderAddHost, useProviderAddFlow } from "@/modules/provider-add/add-flow-host";

import { SavedViewFrame } from "./saved-view-frame";
import { SavedViewGrid } from "./saved-view-grid";
import { SavedViewLayoutSelector, useSavedViewLayout } from "./saved-view-layout-selector";
import { SavedViewList } from "./saved-view-list";
import { SavedViewPagination } from "./saved-view-pagination";
import { SavedViewResultCount } from "./saved-view-result-count";
import { SavedViewTable } from "./saved-view-table";
import type { SavedViewActiveData, SavedViewResultState } from "./state";
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
	readonly entitySchemaSlug: EntitySchemaSlug | null;
}) {
	const [layout, setLayout] = useSavedViewLayout(props.viewSlug);
	return (
		<View className="hidden flex-row items-center gap-2.5 md:flex">
			<Pressable
				disabled={props.isEmpty}
				onPress={() => undefined}
				accessibilityRole="button"
				accessibilityLabel={`Search ${props.viewName}`}
				className={clsx(
					"h-8.5 w-60 flex-row items-center gap-2 rounded-md border border-border-strong bg-bg px-2.5",
					props.isEmpty && "opacity-50",
				)}
			>
				<AppIcon className="text-text-muted" name="search" size={15} />
				<Text numberOfLines={1} className="min-w-0 flex-1 font-ui text-[13px] text-text-muted">
					Search {props.viewName}
				</Text>
				<View className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5">
					<Text className="font-mono text-[11px] text-text-subtle">/</Text>
				</View>
			</Pressable>
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
					<Text className="font-ui text-[11px] text-accent-text">3</Text>
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
		readonly refresh: () => void;
		readonly loadMore: () => void;
		readonly isLoadingMore: boolean;
		readonly record: SavedViewRecord;
		readonly onAdd?: () => void;
		readonly managedUrls: ReadonlyMap<string, string>;
	},
) {
	const { items, pageInfo } = props.data;
	return (
		<SavedViewFrame
			viewSlug={props.record.slug}
			onAdd={props.onAdd}
			title={{
				loaded: items.length,
				icon: props.record.icon,
				name: props.record.name,
				hasMore: pageInfo.hasMore,
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
						<SavedViewResultCount
							loaded={items.length}
							hasMore={pageInfo.hasMore}
							textClassName="font-ui text-xs md:text-sm"
						/>
					</View>
					<SavedViewWebActions
						isEmpty={items.length === 0}
						viewName={props.record.name}
						viewSlug={props.record.slug}
						onAdd={props.onAdd}
						entitySchemaSlug={props.record.entitySchemaSlug}
					/>
				</View>

				{items.length === 0 ? (
					<EmptyState
						name={props.record.name}
						onAdd={props.onAdd}
						entitySchemaSlug={props.record.entitySchemaSlug}
					/>
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
	readonly refresh: () => void;
	readonly loadMore: () => void;
	readonly isLoadingMore: boolean;
	readonly record: SavedViewRecord;
	readonly state: Extract<SavedViewResultState, { status: "ready" }>;
}) {
	const providerAdd = useProviderAddFlow();
	const onAdd = props.record.entitySchemaSlug === null ? undefined : providerAdd.open;
	return (
		<>
			<SavedViewRuntime assets={props.state.assets}>
				{(assets) => (
					<SavedViewDisplay {...props} {...props.state} onAdd={onAdd} managedUrls={assets.urls} />
				)}
			</SavedViewRuntime>
			{props.record.entitySchemaSlug === null ? null : (
				<ProviderAddHost
					onImported={props.refresh}
					entitySchemaSlug={props.record.entitySchemaSlug}
				/>
			)}
		</>
	);
}
