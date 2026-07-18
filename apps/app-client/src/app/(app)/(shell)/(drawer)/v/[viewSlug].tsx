import type { SavedViewRecord } from "@ryot/ryotql-recipes/saved-view-records";
import { useLocalSearchParams } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { useAuthClient } from "@/modules/auth/client";
import { NavigationStatus } from "@/modules/navigation/navigation-status";
import { SavedViewReadyContent } from "@/modules/saved-views/saved-view-content";
import { SavedViewFrame } from "@/modules/saved-views/saved-view-frame";
import { savedViewError, type SavedViewError } from "@/modules/saved-views/state";
import { useSavedViewRecord, useSavedViewResult } from "@/modules/saved-views/use-saved-view";
import { useServerUrl } from "@/modules/server/state";

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

function SavedViewContent(props: { record: SavedViewRecord; serverUrl: string; userId: string }) {
	const result = useSavedViewResult(props);
	if (result.state.status === "loading") {
		return (
			<SavedViewFrame viewSlug={props.record.slug}>
				<NavigationStatus title="Loading saved view..." />
			</SavedViewFrame>
		);
	}
	if (result.state.status === "transport-error" || result.state.status === "malformed") {
		return (
			<SavedViewFrame viewSlug={props.record.slug}>
				<ErrorState {...savedViewError(result.state)} onRetry={result.refresh} />
			</SavedViewFrame>
		);
	}
	return (
		<SavedViewReadyContent
			{...props}
			state={result.state}
			refresh={result.refresh}
			loadMore={result.loadMore}
			isLoadingMore={result.isLoadingMore}
		/>
	);
}

function SavedViewRecordLoader(props: { slug: string; serverUrl: string; userId: string }) {
	const result = useSavedViewRecord(props);
	if (result.state.status === "loading") {
		return (
			<SavedViewFrame viewSlug={props.slug}>
				<NavigationStatus title="Loading saved view..." />
			</SavedViewFrame>
		);
	}
	if (result.state.status === "transport-error" || result.state.status === "malformed") {
		return (
			<SavedViewFrame viewSlug={props.slug}>
				<ErrorState {...savedViewError(result.state)} onRetry={result.refresh} />
			</SavedViewFrame>
		);
	}
	if (result.state.status === "not-found") {
		return (
			<SavedViewFrame viewSlug={props.slug}>
				<NavigationStatus title="Saved view not found" detail="This saved view does not exist." />
			</SavedViewFrame>
		);
	}
	return (
		<SavedViewContent
			userId={props.userId}
			serverUrl={props.serverUrl}
			record={result.state.record}
		/>
	);
}

export default function SavedViewScreen() {
	const client = useAuthClient();
	const serverUrl = useServerUrl();
	const { data: session, isPending } = client.useSession();
	const { viewSlug } = useLocalSearchParams<{ viewSlug?: string | string[] }>();
	const slug = (Array.isArray(viewSlug) ? viewSlug[0] : viewSlug)?.trim();

	if (!slug) {
		return <NavigationStatus title="Saved view not found" detail="The view URL is invalid." />;
	}
	if (isPending || !serverUrl) {
		return (
			<SavedViewFrame viewSlug={slug}>
				<NavigationStatus title="Loading saved view..." />
			</SavedViewFrame>
		);
	}
	if (!session) {
		return (
			<SavedViewFrame viewSlug={slug}>
				<NavigationStatus title="Unable to load saved view" />
			</SavedViewFrame>
		);
	}
	return <SavedViewRecordLoader slug={slug} serverUrl={serverUrl} userId={session.user.id} />;
}
