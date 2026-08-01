import clsx from "clsx";
import { useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppIcon } from "@/modules/icons";
import { getNavigationHref } from "@/modules/navigation/navigation-data";
import { useWorkspaceDrawer } from "@/modules/navigation/workspace-drawer";

import { SavedViewFilterSheet } from "./saved-view-filter-sheet";

const TOP_BAR_HEIGHT = 44;
const TOP_BAR_WEB_HIDDEN = Platform.OS === "web" ? "md:hidden" : null;

export function SavedViewFrame(props: {
	viewSlug: string;
	children: ReactNode;
	title?: { icon: string; name: string; loaded: number; total: number };
}) {
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const drawer = useWorkspaceDrawer();
	const [isFilterOpen, setIsFilterOpen] = useState(false);

	function goBack() {
		if (router.canGoBack()) {
			router.back();
			return;
		}
		router.replace(
			getNavigationHref(drawer.navigation.workspace.slug, { kind: "home", slug: "home" }),
		);
	}

	return (
		<View className="relative flex-1 bg-bg">
			<ScrollView
				className="flex-1"
				contentContainerClassName="min-h-full overflow-hidden pb-8 px-4 md:px-8 md:pt-8"
			>
				<View
					className={clsx(TOP_BAR_WEB_HIDDEN)}
					style={{ height: insets.top + TOP_BAR_HEIGHT }}
				/>
				{props.children}
			</ScrollView>
			<View
				style={{ paddingTop: insets.top }}
				className={clsx("absolute inset-x-0 top-0 z-20 bg-bg px-4", TOP_BAR_WEB_HIDDEN)}
			>
				<View className="h-11 flex-row items-center gap-2.5">
					<Pressable
						onPress={goBack}
						accessibilityRole="button"
						accessibilityLabel="Go back"
						className="h-8 w-8 items-center justify-center rounded-pill bg-surface-2"
					>
						<AppIcon className="text-text" name="chevron-left" size={17} />
					</Pressable>
					{props.title && (
						<View className="min-w-0 flex-1">
							<View className="flex-row items-center gap-1.5">
								<AppIcon className="shrink-0 text-accent-text" name={props.title.icon} size={13} />
								<Text
									numberOfLines={1}
									className="min-w-0 flex-1 font-ui-semibold text-[19px] text-text"
								>
									{props.title.name}
								</Text>
							</View>
							<Text className="font-ui text-[11px] text-text-muted">
								{props.title.loaded.toLocaleString()} of {props.title.total.toLocaleString()}
							</Text>
						</View>
					)}
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Search this view"
						className="h-8 w-8 items-center justify-center rounded-pill bg-surface-2"
					>
						<AppIcon className="text-text-muted" name="search" size={16} />
					</Pressable>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="View options"
						onPress={() => setIsFilterOpen(true)}
						className="h-8 w-8 items-center justify-center rounded-pill bg-surface-2"
					>
						<AppIcon className="text-text-muted" name="sliders-horizontal" size={16} />
					</Pressable>
				</View>
			</View>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel="Add to this view"
				className={clsx(
					"absolute bottom-8 right-4 z-20 h-14 w-14 items-center justify-center rounded-pill bg-accent shadow-card",
					TOP_BAR_WEB_HIDDEN,
				)}
			>
				<AppIcon className="text-accent-ink" name="plus" size={24} />
			</Pressable>
			{isFilterOpen && (
				<View pointerEvents="box-none" className="absolute inset-0 z-50">
					<SavedViewFilterSheet viewSlug={props.viewSlug} onClose={() => setIsFilterOpen(false)} />
				</View>
			)}
		</View>
	);
}
