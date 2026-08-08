import clsx from "clsx";
import { useNavigation } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { Platform, Pressable, View } from "react-native";

import { AppIcon } from "@/modules/icons";
import { HeaderAction, HeaderLeadingControl } from "@/modules/navigation/header/header-control";
import { HeaderFrame } from "@/modules/navigation/header/header-frame";
import { HeaderSearchRow } from "@/modules/navigation/header/header-search-row";
import { useWorkspaceDrawer } from "@/modules/navigation/workspace-drawer";

import { SavedViewFilterSheet } from "./saved-view-filter-sheet";
import type { SavedViewSearch } from "./saved-view-search";

const FAB_WEB_HIDDEN = Platform.OS === "web" ? "md:hidden" : null;

export function SavedViewFrame(props: {
	title: string;
	viewSlug: string;
	meta?: ReactNode;
	children: ReactNode;
	onAdd?: () => void;
	search?: SavedViewSearch;
	initialScrollOffset?: number;
	onScrollOffsetChange?: (offset: number) => void;
}) {
	const drawer = useWorkspaceDrawer();
	const navigation = useNavigation();
	const [isFilterOpen, setIsFilterOpen] = useState(false);
	const [isSearchOpen, setIsSearchOpen] = useState(() => (props.search?.query ?? "") !== "");
	const search = props.search;

	useEffect(() => {
		if (Platform.OS !== "ios") {
			return undefined;
		}
		navigation.setOptions({ gestureEnabled: !isSearchOpen });
		return () => navigation.setOptions({ gestureEnabled: true });
	}, [isSearchOpen, navigation]);

	function exitSearch() {
		setIsSearchOpen(false);
	}

	return (
		<View className="relative flex-1 bg-bg">
			<HeaderFrame
				title={props.title}
				meta={props.meta}
				onSearchEdgeSwipe={exitSearch}
				initialScrollOffset={props.initialScrollOffset}
				onScrollOffsetChange={props.onScrollOffsetChange}
				leading={
					<HeaderLeadingControl icon="menu" label="Open navigation" onPress={drawer.openDrawer} />
				}
				searchRow={
					isSearchOpen && search ? (
						<HeaderSearchRow
							value={search.value}
							onExit={exitSearch}
							onClear={search.onClear}
							onChange={search.onChange}
							onSubmit={search.onSubmit}
							isSearching={search.isSearching}
							label={`Search ${props.title}...`}
						/>
					) : undefined
				}
				actions={
					<>
						<HeaderAction
							icon="search"
							disabled={!search}
							label="Search this view"
							onPress={() => setIsSearchOpen(true)}
						/>
						<HeaderAction
							badge={0}
							icon="sliders-horizontal"
							label="View options, 0 active filters"
							onPress={() => setIsFilterOpen(true)}
						/>
					</>
				}
			>
				{props.children}
			</HeaderFrame>
			{props.onAdd && (
				<Pressable
					onPress={props.onAdd}
					accessibilityRole="button"
					accessibilityLabel="Add to this view"
					className={clsx(
						"absolute bottom-12 right-8 z-20 items-center justify-center rounded-pill bg-accent shadow-card",
						FAB_WEB_HIDDEN,
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
