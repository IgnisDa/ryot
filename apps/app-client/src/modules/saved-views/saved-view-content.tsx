import type { SavedViewRecord } from "@ryot/ryotql-recipes/saved-view-records";
import clsx from "clsx";
import { Platform, Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";

import { savedViewResultCount } from "./result-count";
import { SavedViewFrame } from "./saved-view-frame";
import { SavedViewGrid } from "./saved-view-grid";
import { SavedViewLayoutSelector } from "./saved-view-layout-selector";
import { SavedViewList } from "./saved-view-list";
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

function SavedViewDisplay(
	props: SavedViewActiveData & {
		readonly userId: string;
		readonly serverUrl: string;
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
					<SavedViewLayoutSelector
						userId={props.userId}
						serverUrl={props.serverUrl}
						viewSlug={props.record.slug}
					/>
				</View>

				{items.length === 0 ? (
					<EmptyState name={props.record.name} />
				) : (
					<SavedViewItems {...props} />
				)}
			</View>
		</SavedViewFrame>
	);
}

export function SavedViewReadyContent(props: {
	readonly userId: string;
	readonly serverUrl: string;
	readonly refresh: () => void;
	readonly record: SavedViewRecord;
	readonly state: Extract<SavedViewResultState, { status: "ready" }>;
}) {
	return (
		<SavedViewRuntime
			assets={props.state.assets}
			onEntityUpdated={props.refresh}
			entityIds={props.state.entityIds}
			scope={{ ...props, viewSlug: props.record.slug }}
		>
			{(assets) => <SavedViewDisplay {...props} {...props.state} managedUrls={assets.urls} />}
		</SavedViewRuntime>
	);
}
