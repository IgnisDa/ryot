import type { NavigationData } from "@ryot-app/ryotql-recipes/navigation";
import clsx from "clsx";
import { router } from "expo-router";
import { useCallback, useEffect } from "react";
import { Alert, BackHandler, Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { customizeHaptics } from "./customize-haptics";
import { CustomizePanel } from "./customize-panel";
import { useCustomizeDraft } from "./use-customize-draft";

export function CustomizeScreen(props: { data: NavigationData; workspaceSlug: string }) {
	const insets = useSafeAreaInsets();
	const customize = useCustomizeDraft(props);

	const leave = useCallback(() => {
		if (!customize.isDirty) {
			router.back();
			return;
		}

		Alert.alert("Discard sidebar changes?", "Your unsaved sidebar changes will be lost.", [
			{ text: "Keep editing", style: "cancel" },
			{ text: "Discard", style: "destructive", onPress: () => router.back() },
		]);
	}, [customize.isDirty]);

	useEffect(() => {
		if (Platform.OS !== "android") {
			return undefined;
		}
		const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
			leave();
			return true;
		});
		return () => subscription.remove();
	}, [leave]);

	async function save() {
		if (await customize.save()) {
			router.back();
		}
	}

	return (
		<View className="flex-1 bg-bg">
			<View style={{ paddingTop: insets.top }} className="border-b border-border bg-surface">
				<View className="relative h-13.5 flex-row items-center justify-between px-4">
					<View className="flex-1 items-start">
						<Pressable
							onPress={leave}
							accessibilityRole="button"
							accessibilityLabel="Cancel sidebar customization"
						>
							<Text className="font-ui-medium text-sm text-text-muted">Cancel</Text>
						</Pressable>
					</View>
					<Text className="absolute inset-x-0 text-center font-ui-semibold text-[19px] text-text">
						Customize sidebar
					</Text>
					<View className="flex-1 items-end">
						<Pressable
							onPress={() => void save()}
							accessibilityRole="button"
							accessibilityLabel="Save sidebar changes"
							disabled={!customize.isDirty || customize.isSaving}
						>
							<Text
								className={clsx(
									"font-ui-medium text-sm",
									customize.isDirty && !customize.isSaving
										? "text-accent-text"
										: "text-text-subtle",
								)}
							>
								{customize.isSaving ? "Saving..." : "Save"}
							</Text>
						</Pressable>
					</View>
				</View>
			</View>
			<View className="flex-1">
				{customize.error !== null && (
					<Text className="px-4 pt-3 font-ui text-xs text-danger">{customize.error}</Text>
				)}
				<View className="flex-1">
					<CustomizePanel
						draft={customize.draft}
						onMove={customize.move}
						onToggle={customize.toggle}
						onDrop={customizeHaptics.onDrop}
						onPickUp={customizeHaptics.onPickUp}
					/>
				</View>
			</View>
		</View>
	);
}
