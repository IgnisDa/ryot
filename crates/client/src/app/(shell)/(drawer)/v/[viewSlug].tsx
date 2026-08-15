import type { SavedViewRecord } from "@ryot-app/ryotql-recipes/saved-view-records";
import { useLocalSearchParams } from "expo-router";

import { NavigationStatus } from "@/modules/navigation/navigation-status";
import { useWorkspaceDrawer } from "@/modules/navigation/workspace-drawer";
import {
	SavedViewErrorState,
	SavedViewResultContent,
} from "@/modules/saved-views/saved-view-content";
import { SavedViewFrame } from "@/modules/saved-views/saved-view-frame";
import { savedViewError } from "@/modules/saved-views/state";
import { useSavedViewRecord, useSavedViewResult } from "@/modules/saved-views/use-saved-view";
import { useSavedViewSession } from "@/modules/saved-views/use-saved-view-session";

function SavedViewContent(props: { record: SavedViewRecord }) {
	const drawer = useWorkspaceDrawer();
	const session = useSavedViewSession({
		slug: props.record.slug,
		workspace: drawer.navigation.workspace.slug,
	});
	const result = useSavedViewResult(props.record, session.search.query, {
		initialController: session.initialController,
		onControllerChange: session.onControllerChange,
	});
	return (
		<SavedViewResultContent
			state={result.state}
			record={props.record}
			refresh={result.refresh}
			loadMore={result.loadMore}
			queryDocument={result.queryDocument}
			isLoadingMore={result.isLoadingMore}
			isLayoutChanging={result.isLayoutChanging}
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
				<SavedViewErrorState {...savedViewError(result.state)} onRetry={result.refresh} />
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
