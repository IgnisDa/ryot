import { useQuery } from "@tanstack/react-query";
import type { Href } from "expo-router";
import { usePathname } from "expo-router";
import { atom, useAtomValue, useSetAtom } from "jotai";
import { useMemo } from "react";
import { useApiClient } from "@/lib/api-client";
import {
	buildNavigationItems,
	type NavigationItem,
	type NavigationSubItem,
	unwrapData,
} from "@/lib/navigation-data";

export type { NavigationItem, NavigationSubItem };

const navSheetOpenAtom = atom(false);
const subFlyoutOpenAtom = atom(false);

export const useNavSheetOpen = () => useAtomValue(navSheetOpenAtom);
export const useSetNavSheetOpen = () => useSetAtom(navSheetOpenAtom);
export const useSubFlyoutOpen = () => useAtomValue(subFlyoutOpenAtom);
export const useSetSubFlyoutOpen = () => useSetAtom(subFlyoutOpenAtom);

interface UseNavigationDataResult {
	isError: boolean;
	isLoading: boolean;
	homeItem: NavigationItem;
	userItem: NavigationItem;
	trackers: NavigationItem[];
	libraryViews: NavigationItem[];
}

export function useNavigationData(userName?: string): UseNavigationDataResult {
	const apiClient = useApiClient();

	const trackersQuery = useQuery({
		queryKey: ["trackers"],
		queryFn: async () => {
			const response = await apiClient.GET("/trackers");
			if (response.error) {
				throw response.error;
			}
			return response.data;
		},
	});

	const viewsQuery = useQuery({
		queryKey: ["saved-views"],
		queryFn: async () => {
			const response = await apiClient.GET("/saved-views");
			if (response.error) {
				throw response.error;
			}
			return response.data;
		},
	});

	const isLoading = trackersQuery.isLoading || viewsQuery.isLoading;
	const isError = trackersQuery.isError || viewsQuery.isError;

	const homeItem: NavigationItem = {
		key: "home",
		slug: "home",
		name: "Home",
		icon: "home",
		kind: "home",
		subItems: [],
		accentColor: null,
	};

	const userItem: NavigationItem = {
		key: "user",
		slug: "user",
		icon: "user",
		kind: "user",
		subItems: [],
		accentColor: null,
		name: userName ?? "Account",
	};

	const data = useMemo(() => {
		const rawTrackers = unwrapData(trackersQuery.data);
		const rawViews = unwrapData(viewsQuery.data);
		return buildNavigationItems(rawTrackers, rawViews);
	}, [trackersQuery.data, viewsQuery.data]);

	const allTrackers = [homeItem, ...data.trackerItems];

	return {
		isError,
		homeItem,
		userItem,
		isLoading,
		trackers: allTrackers,
		libraryViews: data.libraryViews,
	};
}

export function navHref(item: NavigationItem): Href {
	if (item.kind === "home") {
		return "/";
	}
	if (item.kind === "view") {
		return `/views/${item.slug}` as Href;
	}
	return `/tracker/${item.slug}` as Href;
}

export function useActiveNav() {
	const pathname = usePathname();
	const { trackers } = useNavigationData();
	const segments = pathname.split("/").filter(Boolean);
	const isViewPath = segments[0] === "views";
	const isTrackerPath = segments[0] === "tracker";
	const activeSubItemSlug = isViewPath ? (segments[1] ?? null) : null;
	const activeTrackerSlug = isViewPath
		? (trackers.find((t) =>
				t.subItems.some((s) => s.slug === activeSubItemSlug),
			)?.slug ?? "home")
		: isTrackerPath
			? segments[1] || "home"
			: segments[0] || "home";
	return { isViewPath, isTrackerPath, activeTrackerSlug, activeSubItemSlug };
}
