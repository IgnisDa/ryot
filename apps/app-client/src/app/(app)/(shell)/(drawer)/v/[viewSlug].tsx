import type { SavedViewRecord } from "@ryot/ryotql-recipes/saved-view-records";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { NavigationStatus } from "@/modules/navigation/navigation-status";
import { savedViewResultCount } from "@/modules/saved-views/result-count";
import { SavedViewReadyContent } from "@/modules/saved-views/saved-view-content";
import { SavedViewFrame } from "@/modules/saved-views/saved-view-frame";
import { savedViewError, type SavedViewError } from "@/modules/saved-views/state";
import { useSavedViewRecord, useSavedViewResult } from "@/modules/saved-views/use-saved-view";

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
	const [query, setQuery] = useState("");
	const [searchValue, setSearchValue] = useState("");
	const result = useSavedViewResult(props.record, query);
	useEffect(() => {
		const normalized = searchValue.trim();
		if (normalized === query) {
			return undefined;
		}
		const timer = setTimeout(() => setQuery(normalized), 300);
		return () => clearTimeout(timer);
	}, [query, searchValue]);
	const clearSearch = () => {
		setQuery("");
		setSearchValue("");
	};
	const submitSearch = () => setQuery(searchValue.trim());
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
			state={result.state}
			record={props.record}
			refresh={result.refresh}
			loadMore={result.loadMore}
			isLoadingMore={result.isLoadingMore}
			search={{
				query,
				value: searchValue,
				onClear: clearSearch,
				onSubmit: submitSearch,
				onChange: setSearchValue,
				isSearching: result.isSearching,
				resultLabel: `${savedViewResultCount(
					result.state.data.items.length,
					result.state.data.pageInfo.hasMore,
				)} in ${props.record.name}`,
			}}
		/>
	);
}

function SavedViewRecordLoader(props: { slug: string }) {
	const result = useSavedViewRecord(props.slug);
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
