import { useAtomValue } from "@effect/atom-react";
import {
	decodeSavedViewRecordResponse,
	type SavedViewRecord,
} from "@ryot/ryotql-recipes/saved-view-records";
import { Cause, Option, Result } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";

import {
	managedAssetResolutionAtom,
	savedViewLayoutAtom,
	savedViewRecordAtom,
	savedViewResultAtom,
} from "@/api/atoms";
import { AppIcon } from "@/modules/icons";
import { NavigationStatus } from "@/modules/navigation/navigation-status";
import {
	collectManagedAssets,
	decodeSavedViewDisplayData,
	resolvedAssetUrls,
	type SavedViewDisplayData,
} from "@/modules/saved-views/display-data";
import { SavedViewGrid } from "@/modules/saved-views/saved-view-grid";
import { SavedViewLayoutSelector } from "@/modules/saved-views/saved-view-layout-selector";
import { SavedViewList } from "@/modules/saved-views/saved-view-list";
import { SavedViewTable } from "@/modules/saved-views/saved-view-table";
import { useServerUrl } from "@/modules/server/state";
import { CLOUD_URL } from "@/modules/server/url";

function ErrorState(props: { detail: string; title: string }) {
	return (
		<View className="min-h-96 items-center justify-center gap-3 px-6">
			<Text className="font-ui-medium text-base text-text">{props.title}</Text>
			<Text selectable className="max-w-xl text-center font-mono text-xs text-danger">
				{props.detail}
			</Text>
		</View>
	);
}

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

function SavedViewItems(props: {
	layout: "grid" | "list" | "table";
	managedUrls: ReadonlyMap<string, string>;
	items: Parameters<typeof SavedViewGrid>[0]["items"];
}) {
	if (props.layout === "grid") {
		return <SavedViewGrid items={props.items} managedUrls={props.managedUrls} />;
	}
	if (props.layout === "list") {
		return <SavedViewList items={props.items} managedUrls={props.managedUrls} />;
	}
	return <SavedViewTable items={props.items} managedUrls={props.managedUrls} />;
}

function SavedViewResolvedContent(props: {
	icon: string;
	name: string;
	viewSlug: string;
	data: SavedViewDisplayData;
	layout: "grid" | "list" | "table";
}) {
	const serverUrl = useServerUrl() ?? CLOUD_URL;
	const assets = collectManagedAssets(props.data.items, props.layout);
	if (assets.length === 0) {
		return <SavedViewDisplay {...props} managedUrls={new Map()} />;
	}
	return (
		<SavedViewManagedContent
			{...props}
			serverUrl={serverUrl}
			serializedRequest={JSON.stringify({ assets, serverUrl })}
		/>
	);
}

function SavedViewManagedContent(
	props: Parameters<typeof SavedViewResolvedContent>[0] & {
		serverUrl: string;
		serializedRequest: string;
	},
) {
	const result = useAtomValue(managedAssetResolutionAtom(props.serializedRequest));
	const response = AsyncResult.isSuccess(result) ? result.value : undefined;
	return (
		<SavedViewDisplay
			{...props}
			managedUrls={response ? resolvedAssetUrls(response, props.serverUrl) : new Map()}
		/>
	);
}

function SavedViewDisplay(
	props: Parameters<typeof SavedViewResolvedContent>[0] & {
		managedUrls: ReadonlyMap<string, string>;
	},
) {
	const { items, pageInfo } = props.data;
	return (
		<View className="w-full gap-5">
			<View className="gap-3 md:h-15 md:flex-row md:items-start md:justify-between md:gap-6">
				<View className="min-w-0 gap-1">
					<View className="flex-row items-center gap-2.5">
						<AppIcon className="shrink-0 text-text-muted" name={props.icon} size={20} />
						<Text
							numberOfLines={1}
							className="min-w-0 flex-1 font-ui-semibold text-xl text-text md:font-display md:text-3xl"
						>
							{props.name}
						</Text>
					</View>
					<Text className="font-ui text-xs text-text-muted md:text-sm">
						{pageInfo.total.toLocaleString()} {pageInfo.total === 1 ? "result" : "results"}
					</Text>
				</View>
				<SavedViewLayoutSelector viewSlug={props.viewSlug} />
			</View>

			{items.length === 0 ? (
				<EmptyState name={props.name} />
			) : (
				<SavedViewItems items={items} layout={props.layout} managedUrls={props.managedUrls} />
			)}
		</View>
	);
}

function SavedViewContent(props: { record: SavedViewRecord }) {
	const queryResult = useAtomValue(savedViewResultAtom(props.record));
	const layout = useAtomValue(savedViewLayoutAtom(props.record.slug));
	const response = Option.getOrUndefined(AsyncResult.value(queryResult));
	const decoded = response
		? decodeSavedViewDisplayData(response, props.record.displayConfiguration)
		: undefined;

	if (!response) {
		return AsyncResult.isFailure(queryResult) ? (
			<ErrorState title="Unable to load saved view" detail={Cause.pretty(queryResult.cause)} />
		) : (
			<NavigationStatus title="Loading saved view..." />
		);
	}
	if (!decoded || Result.isFailure(decoded)) {
		return (
			<ErrorState
				title="Unable to display saved view"
				detail={String(decoded?.failure ?? "Malformed saved-view response")}
			/>
		);
	}

	return (
		<SavedViewResolvedContent
			layout={layout}
			data={decoded.success}
			icon={props.record.icon}
			name={props.record.name}
			viewSlug={props.record.slug}
		/>
	);
}

export default function SavedViewScreen() {
	const { viewSlug } = useLocalSearchParams<{ viewSlug?: string | string[] }>();
	const slug = (Array.isArray(viewSlug) ? viewSlug[0] : viewSlug)?.trim();

	if (!slug) {
		return <NavigationStatus title="Saved view not found" detail="The view URL is invalid." />;
	}
	return <SavedViewRecordLoader slug={slug} />;
}

function SavedViewRecordLoader(props: { slug: string }) {
	const recordResult = useAtomValue(savedViewRecordAtom(props.slug));
	const response = Option.getOrUndefined(AsyncResult.value(recordResult));
	const decoded = response ? decodeSavedViewRecordResponse(response) : undefined;

	if (!response) {
		return AsyncResult.isFailure(recordResult) ? (
			<ErrorState title="Unable to load saved view" detail={Cause.pretty(recordResult.cause)} />
		) : (
			<NavigationStatus title="Loading saved view..." />
		);
	}
	if (!decoded || Result.isFailure(decoded)) {
		return (
			<ErrorState
				title="Unable to read saved view"
				detail={String(decoded?.failure ?? "Malformed saved-view response")}
			/>
		);
	}
	if (decoded.success === null) {
		return (
			<NavigationStatus title="Saved view not found" detail="This saved view does not exist." />
		);
	}
	return <SavedViewContent record={decoded.success} />;
}
