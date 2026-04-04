import { useAtomValue } from "@effect/atom-react";
import type { ManagedAssetLocator } from "@ryot/contract/modules/uploads/schemas";
import {
	decodeSavedViewRecordResponse,
	type SavedViewRecord,
} from "@ryot/ryotql-recipes/saved-view-records";
import { Cause, Option, Result } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";

import { useAuthClient } from "@/modules/auth/client";
import { AppIcon } from "@/modules/icons";
import { NavigationStatus } from "@/modules/navigation/navigation-status";
import {
	managedAssetResolutionAtom,
	savedViewLayoutAtom,
	savedViewRecordAtom,
	savedViewResultAtom,
} from "@/modules/saved-views/atoms";
import {
	collectManagedAssets,
	decodeSavedViewDisplayData,
	resolvedAssetUrls,
	type SavedViewDisplayData,
	type SavedViewDisplayItem,
} from "@/modules/saved-views/display-data";
import { SavedViewGrid } from "@/modules/saved-views/saved-view-grid";
import {
	SavedViewLayoutSelector,
	type SavedViewLayout,
} from "@/modules/saved-views/saved-view-layout-selector";
import { SavedViewList } from "@/modules/saved-views/saved-view-list";
import { SavedViewTable } from "@/modules/saved-views/saved-view-table";
import { useServerUrl } from "@/modules/server/state";

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
	layout: SavedViewLayout;
	managedUrls: ReadonlyMap<string, string>;
	items: readonly SavedViewDisplayItem[];
}) {
	if (props.layout === "grid") {
		return <SavedViewGrid items={props.items} managedUrls={props.managedUrls} />;
	}
	if (props.layout === "list") {
		return <SavedViewList items={props.items} managedUrls={props.managedUrls} />;
	}
	return <SavedViewTable items={props.items} managedUrls={props.managedUrls} />;
}

type SavedViewPresentationProps = {
	icon: string;
	name: string;
	userId: string;
	viewSlug: string;
	serverUrl: string;
	layout: SavedViewLayout;
	data: SavedViewDisplayData;
};

function SavedViewResolvedContent(props: SavedViewPresentationProps) {
	const assets = collectManagedAssets(props.data.items, props.layout);
	if (assets.length === 0) {
		return (
			<SavedViewDisplay
				data={props.data}
				icon={props.icon}
				name={props.name}
				layout={props.layout}
				managedUrls={new Map()}
				viewSlug={props.viewSlug}
			/>
		);
	}
	return (
		<SavedViewManagedContent
			assets={assets}
			data={props.data}
			icon={props.icon}
			name={props.name}
			userId={props.userId}
			layout={props.layout}
			viewSlug={props.viewSlug}
			serverUrl={props.serverUrl}
		/>
	);
}

function SavedViewManagedContent(
	props: SavedViewPresentationProps & { assets: readonly ManagedAssetLocator[] },
) {
	const result = useAtomValue(
		managedAssetResolutionAtom({
			assets: props.assets,
			userId: props.userId,
			serverUrl: props.serverUrl,
		}),
	);
	const response = AsyncResult.isSuccess(result) ? result.value : undefined;
	return (
		<SavedViewDisplay
			data={props.data}
			icon={props.icon}
			name={props.name}
			layout={props.layout}
			viewSlug={props.viewSlug}
			managedUrls={response ? resolvedAssetUrls(response, props.serverUrl) : new Map()}
		/>
	);
}

function SavedViewDisplay(props: {
	icon: string;
	name: string;
	viewSlug: string;
	layout: SavedViewLayout;
	data: SavedViewDisplayData;
	managedUrls: ReadonlyMap<string, string>;
}) {
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

function SavedViewContent(props: { record: SavedViewRecord; serverUrl: string; userId: string }) {
	const queryResult = useAtomValue(
		savedViewResultAtom({
			userId: props.userId,
			serverUrl: props.serverUrl,
			queryDocument: props.record.queryDocument,
		}),
	);
	const layout = useAtomValue(savedViewLayoutAtom(props.record.slug));
	if (AsyncResult.isFailure(queryResult)) {
		return (
			<ErrorState title="Unable to load saved view" detail={Cause.pretty(queryResult.cause)} />
		);
	}
	const response = Option.getOrUndefined(AsyncResult.value(queryResult));
	const decoded = response
		? decodeSavedViewDisplayData(response, props.record.displayConfiguration)
		: undefined;

	if (!response) {
		return <NavigationStatus title="Loading saved view..." />;
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
			userId={props.userId}
			data={decoded.success}
			icon={props.record.icon}
			name={props.record.name}
			serverUrl={props.serverUrl}
			viewSlug={props.record.slug}
		/>
	);
}

export default function SavedViewScreen() {
	const client = useAuthClient();
	const serverUrl = useServerUrl();
	const { data: session, isPending } = client.useSession();
	const { viewSlug } = useLocalSearchParams<{ viewSlug?: string | string[] }>();
	const slug = (Array.isArray(viewSlug) ? viewSlug[0] : viewSlug)?.trim();

	if (isPending || !serverUrl) {
		return <NavigationStatus title="Loading saved view..." />;
	}
	if (!session) {
		return <NavigationStatus title="Unable to load saved view" />;
	}
	if (!slug) {
		return <NavigationStatus title="Saved view not found" detail="The view URL is invalid." />;
	}
	return <SavedViewRecordLoader slug={slug} serverUrl={serverUrl} userId={session.user.id} />;
}

function SavedViewRecordLoader(props: { slug: string; serverUrl: string; userId: string }) {
	const recordResult = useAtomValue(savedViewRecordAtom(props));
	if (AsyncResult.isFailure(recordResult)) {
		return (
			<ErrorState title="Unable to load saved view" detail={Cause.pretty(recordResult.cause)} />
		);
	}
	const response = Option.getOrUndefined(AsyncResult.value(recordResult));
	const decoded = response ? decodeSavedViewRecordResponse(response) : undefined;

	if (!response) {
		return <NavigationStatus title="Loading saved view..." />;
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
	return (
		<SavedViewContent record={decoded.success} userId={props.userId} serverUrl={props.serverUrl} />
	);
}
