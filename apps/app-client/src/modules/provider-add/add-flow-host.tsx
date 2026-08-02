import { Match } from "effect";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { BackHandler, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { parseAddParam, PROVIDER_ADD_PICKER_VALUE, PROVIDER_ADD_SEARCH_PARAM } from "./flow-state";
import { ProviderSearchPanel } from "./provider-search-panel";
import { ProviderAddSchemaPicker } from "./schema-picker";

type ProviderAddParams = Partial<Record<typeof PROVIDER_ADD_SEARCH_PARAM, string | string[]>>;

const setAddParam = (value: string | undefined) =>
	router.setParams({ [PROVIDER_ADD_SEARCH_PARAM]: value });

export function useProviderAddFlow() {
	return { open: () => setAddParam(PROVIDER_ADD_PICKER_VALUE) };
}

export function ProviderAddHost(props: { readonly onImported: () => void }) {
	const insets = useSafeAreaInsets();
	const params = useLocalSearchParams<ProviderAddParams>();
	const step = parseAddParam(params[PROVIDER_ADD_SEARCH_PARAM]);
	const isOpen = step.kind !== "closed";

	useEffect(() => {
		const subscription =
			isOpen && Platform.OS !== "web"
				? BackHandler.addEventListener("hardwareBackPress", () => {
						setAddParam(undefined);
						return true;
					})
				: undefined;
		return () => subscription?.remove();
	}, [isOpen]);

	if (step.kind === "closed") {
		return null;
	}

	return (
		<View className="absolute inset-0 z-50 md:items-center md:justify-center md:p-6">
			<Pressable
				accessibilityRole="button"
				accessibilityLabel="Close"
				className="absolute inset-0 bg-overlay"
				onPress={() => setAddParam(undefined)}
			/>
			<View
				style={{ paddingTop: insets.top }}
				className="w-full flex-1 bg-bg md:max-h-[80%] md:max-w-2xl md:flex-initial md:rounded-xl md:border md:border-border md:bg-surface md:shadow-card"
			>
				<ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
					<View className="gap-3 p-4">
						{Match.value(step).pipe(
							Match.when({ kind: "schema-picker" }, () => (
								<ProviderAddSchemaPicker onSelect={(slug) => setAddParam(slug)} />
							)),
							Match.when({ kind: "search" }, (current) => (
								<ProviderSearchPanel
									onImported={props.onImported}
									entitySchemaSlug={current.entitySchemaSlug}
									onClose={() => setAddParam(undefined)}
								/>
							)),
							Match.exhaustive,
						)}
					</View>
				</ScrollView>
			</View>
		</View>
	);
}
