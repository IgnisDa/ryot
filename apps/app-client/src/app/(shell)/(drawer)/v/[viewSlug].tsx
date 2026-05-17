import type { SavedViewRecord } from "@ryot/ryotql-recipes/saved-view-records";
import { useLocalSearchParams } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { NavigationStatus } from "@/modules/navigation/navigation-status";
import { useWorkspaceDrawer } from "@/modules/navigation/workspace-drawer";
import { SavedViewReadyContent } from "@/modules/saved-views/saved-view-content";
import { SavedViewFrame } from "@/modules/saved-views/saved-view-frame";
import { savedViewError, type SavedViewError } from "@/modules/saved-views/state";
import { useSavedViewRecord, useSavedViewResult } from "@/modules/saved-views/use-saved-view";
import { useSavedViewSession } from "@/modules/saved-views/use-saved-view-session";

function ErrorState(props: SavedViewError & { onRetry?: () => void }) {
	return (
		<View className="min-h-96 items-center justify-center gap-3 px-6">
			<Text className="font-ui-medium text-base text-text">{props.title}</Text>
			<Text className="max-w-xl text-center font-ui text-sm text-text-muted">{props.detail}</Text>
			{props.onRetry && (
				<Pressable accessibilityRole="button" onPress={props.onRetry}>
					<Text className="font-ui-medium text-sm text-accent-text">Try again</Text>
				</Pressable>
			)}
		</View>
	);
}

function SavedViewContent(props: { record: SavedViewRecord }) {
	const drawer = useWorkspaceDrawer();
	const session = useSavedViewSession({
		slug: props.record.slug,
		workspace: drawer.navigation.workspace.slug,
	});
	const result = useSavedViewResult(props.record, session.search.query);
	if (result.state.status === "loading") {
		return (
			<SavedViewFrame title={props.record.name} viewSlug={props.record.slug}>
				<NavigationStatus title="Loading saved view..." />
			</SavedViewFrame>
		);
	}
	if (result.state.status === "transport-error" || result.state.status === "malformed") {
		return (
			<SavedViewFrame title={props.record.name} viewSlug={props.record.slug}>
				<ErrorState {...savedViewError(result.state)} onRetry={result.refresh} />
			</SavedViewFrame>
		);
	}
	return (
		<SavedViewReadyContent
			state={result.state}
			record={props.record}
			refresh={result.refresh}
			loadMore={result.loadMore}
			queryDocument={result.queryDocument}
			isLoadingMore={result.isLoadingMore}
			initialScrollOffset={session.initialScrollOffset}
			onScrollOffsetChange={session.onScrollOffsetChange}
			search={{ ...session.search, isSearching: result.isSearching }}
		/>
	);
}

function SavedViewRecordLoader(props: { slug: string }) {
	const result = useSavedViewRecord(props.slug);
	if (result.state.status === "loading") {
		return (
			<SavedViewFrame title="Saved view" viewSlug={props.slug}>
				<NavigationStatus title="Loading saved view..." />
			</SavedViewFrame>
		);
	}
	if (result.state.status === "transport-error" || result.state.status === "malformed") {
		return (
			<SavedViewFrame title="Saved view" viewSlug={props.slug}>
				<ErrorState {...savedViewError(result.state)} onRetry={result.refresh} />
			</SavedViewFrame>
		);
	}
	if (result.state.status === "not-found") {
		return (
			<SavedViewFrame title="Saved view" viewSlug={props.slug}>
				<NavigationStatus title="Saved view not found" detail="This saved view does not exist." />
			</SavedViewFrame>
		);
	}
	return <SavedViewContent key={result.state.record.id} record={result.state.record} />;
}

export default function SavedViewScreen() {
	const { viewSlug } = useLocalSearchParams<{ viewSlug?: string | string[] }>();
	const slug = (Array.isArray(viewSlug) ? viewSlug[0] : viewSlug)?.trim();

	if (!slug) {
		return <NavigationStatus title="Saved view not found" detail="The view URL is invalid." />;
	}
	return <SavedViewRecordLoader slug={slug} />;
}
