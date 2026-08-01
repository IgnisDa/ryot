import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import clsx from "clsx";
import { useRouter } from "expo-router";
import { useRef, useState, type ReactNode } from "react";
import type { TextInput } from "react-native";
import { Platform, Pressable, Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";
import { getNavigationHref } from "@/modules/navigation/navigation-data";
import { useWorkspaceDrawer } from "@/modules/navigation/workspace-drawer";
import { WorkspaceScrollFrame } from "@/modules/navigation/workspace-scroll-frame";

import { SavedViewFilterSheet } from "./saved-view-filter-sheet";
import { SavedViewResultCount } from "./saved-view-result-count";
import { SavedViewSearchField, type SavedViewSearch } from "./saved-view-search";

const TOP_BAR_HEIGHT = 44;
const SEARCH_BAR_HEIGHT = 68;
const TOP_BAR_WEB_HIDDEN = Platform.OS === "web" ? "md:hidden" : null;

export function SavedViewFrame(props: {
	viewSlug: string;
	children: ReactNode;
	onAdd?: () => void;
	search?: SavedViewSearch;
	title?: {
		icon: string;
		name: string;
		loaded: number;
		hasMore: boolean;
		queryDocument: RyotQLDocument;
	};
}) {
	const router = useRouter();
	const drawer = useWorkspaceDrawer();
	const searchInputRef = useRef<TextInput>(null);
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const [isFilterOpen, setIsFilterOpen] = useState(false);
	const isSearchUnavailable =
		!props.search || !props.title || (props.title.loaded === 0 && props.search.query === "");

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
				contentContainerClassName="overflow-hidden"
				headerHeight={isSearchOpen ? SEARCH_BAR_HEIGHT : TOP_BAR_HEIGHT}
				header={
					isSearchOpen && props.search && props.title ? (
						<View className="gap-1.5 py-2">
							<View className="flex-row items-center gap-2.5">
								<SavedViewSearchField
									autoFocus
									search={props.search}
									name={props.title.name}
									inputRef={searchInputRef}
									className="h-8.5 flex-1 bg-surface-2"
								/>
								<Pressable
									accessibilityRole="button"
									accessibilityLabel="Cancel search"
									onPress={() => {
										props.search?.onClear();
										setIsSearchOpen(false);
									}}
								>
									<Text className="font-ui-medium text-sm text-accent-text">Cancel</Text>
								</Pressable>
							</View>
							<Text
								accessibilityLiveRegion="polite"
								className="font-ui text-[11px] text-text-muted"
							>
								{props.search.resultLabel}
							</Text>
						</View>
					) : (
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
									<SavedViewResultCount
										loaded={props.title.loaded}
										hasMore={props.title.hasMore}
										textClassName="font-ui text-[11px]"
										queryDocument={props.title.queryDocument}
									/>
								</View>
							)}
							<Pressable
								accessibilityRole="button"
								disabled={isSearchUnavailable}
								accessibilityLabel="Search this view"
								onPress={() => setIsSearchOpen(true)}
								className={clsx(
									"items-center justify-center rounded-pill bg-surface-2 p-1 ml-auto",
									isSearchUnavailable && "opacity-50",
								)}
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
					)
				}
			>
				{props.children}
			</WorkspaceScrollFrame>
			{props.onAdd && (
				<Pressable
					onPress={props.onAdd}
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
		</View>
	);
}
