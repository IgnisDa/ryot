import clsx from "clsx";
import { useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { Platform, Pressable, Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";
import { getNavigationHref } from "@/modules/navigation/navigation-data";
import { useWorkspaceDrawer } from "@/modules/navigation/workspace-drawer";
import { WorkspaceScrollFrame } from "@/modules/navigation/workspace-scroll-frame";
import { ProviderAddHost, useProviderAddFlow } from "@/modules/provider-add/add-flow-host";

import { savedViewLoadedCount } from "./result-count";
import { SavedViewFilterSheet } from "./saved-view-filter-sheet";

const TOP_BAR_HEIGHT = 44;
const TOP_BAR_WEB_HIDDEN = Platform.OS === "web" ? "md:hidden" : null;

export function SavedViewFrame(props: {
	viewSlug: string;
	children: ReactNode;
	onImported?: () => void;
	title?: { icon: string; name: string; loaded: number; hasMore: boolean };
}) {
	const router = useRouter();
	const drawer = useWorkspaceDrawer();
	const providerAdd = useProviderAddFlow();
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
			<WorkspaceScrollFrame
				headerClassName="px-4"
				headerHeight={TOP_BAR_HEIGHT}
				contentContainerClassName="overflow-hidden"
				header={
					<View className="py-2 flex-row items-center gap-2.5">
						<Pressable
							onPress={goBack}
							accessibilityRole="button"
							accessibilityLabel="Go back"
							className="items-center justify-center rounded-pill bg-surface-2 p-1"
						>
							<AppIcon className="text-text-muted" name="chevron-left" size={30} />
						</Pressable>
						{props.title && (
							<View className="min-w-0 flex-1">
								<View className="flex-row items-center gap-1.5">
									<AppIcon
										size={13}
										name={props.title.icon}
										className="shrink-0 text-accent-text"
									/>
									<Text
										numberOfLines={1}
										className="min-w-0 flex-1 font-ui-semibold text-[19px] text-text"
									>
										{props.title.name}
									</Text>
								</View>
								<Text className="font-ui text-[11px] text-text-muted">
									{savedViewLoadedCount(props.title.loaded, props.title.hasMore)}
								</Text>
							</View>
						)}
						<Pressable
							accessibilityRole="button"
							accessibilityLabel="Search this view"
							className="items-center justify-center rounded-pill bg-surface-2 p-1 ml-auto"
						>
							<AppIcon className="text-text-muted" name="search" size={24} />
						</Pressable>
						<Pressable
							accessibilityRole="button"
							accessibilityLabel="View options"
							onPress={() => setIsFilterOpen(true)}
							className="items-center justify-center rounded-pill bg-surface-2 p-1"
						>
							<AppIcon className="text-text-muted" name="sliders-horizontal" size={24} />
						</Pressable>
					</View>
				}
			>
				{props.children}
			</WorkspaceScrollFrame>
			{props.onImported && (
				<Pressable
					onPress={providerAdd.open}
					accessibilityRole="button"
					accessibilityLabel="Add to this view"
					className={clsx(
						"absolute bottom-12 right-8 z-20 items-center justify-center rounded-pill bg-accent shadow-card",
						TOP_BAR_WEB_HIDDEN,
					)}
				>
					<AppIcon className="text-accent-ink" name="plus" size={36} />
				</Pressable>
			)}
			{isFilterOpen && (
				<View pointerEvents="box-none" className="absolute inset-0 z-50">
					<SavedViewFilterSheet viewSlug={props.viewSlug} onClose={() => setIsFilterOpen(false)} />
				</View>
			)}
			{props.onImported && <ProviderAddHost onImported={props.onImported} />}
		</View>
	);
}
