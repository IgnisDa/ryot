import type { EntitySchemaSlug } from "@ryot/contract/schema/brands";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { BackHandler, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ProviderSearchPanel } from "./provider-search-panel";

const PROVIDER_ADD_OPEN_VALUE = "1";
const PROVIDER_ADD_SEARCH_PARAM = "add";
type ProviderAddParams = Partial<Record<typeof PROVIDER_ADD_SEARCH_PARAM, string | string[]>>;

const setAddParam = (value: string | undefined) =>
	router.setParams({ [PROVIDER_ADD_SEARCH_PARAM]: value });

const isAddOpen = (value: string | string[] | undefined) =>
	(Array.isArray(value) ? value[0] : value) === PROVIDER_ADD_OPEN_VALUE;

export function useProviderAddFlow() {
	return { open: () => setAddParam(PROVIDER_ADD_OPEN_VALUE) };
}

export function ProviderAddHost(props: {
	readonly onImported: () => void;
	readonly entitySchemaSlug: EntitySchemaSlug;
}) {
	const insets = useSafeAreaInsets();
	const params = useLocalSearchParams<ProviderAddParams>();
	const isOpen = isAddOpen(params[PROVIDER_ADD_SEARCH_PARAM]);

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

	if (!isOpen) {
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
						<ProviderSearchPanel
							onImported={props.onImported}
							entitySchemaSlug={props.entitySchemaSlug}
							onClose={() => setAddParam(undefined)}
						/>
					</View>
				</ScrollView>
			</View>
		</View>
	);
}
