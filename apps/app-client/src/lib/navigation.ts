import type { paths } from "@ryot/generated/openapi/app-backend";
import { useQuery } from "@tanstack/react-query";
import { atom, useAtomValue, useSetAtom } from "jotai";
import { useMemo } from "react";
import { useApiClient } from "@/lib/api-client";

type ApiTracker =
	paths["/trackers"]["get"]["responses"][200]["content"]["application/json"]["data"][number];
type ApiSavedView =
	paths["/saved-views"]["get"]["responses"][200]["content"]["application/json"]["data"][number];

export type NavigationSubItem = {
	key: string;
	slug: string;
	name: string;
	icon: string;
	accentColor: string | null;
};

export type NavigationItem = {
	key: string;
	slug: string;
	name: string;
	icon: string;
	accentColor: string | null;
	subItems: NavigationSubItem[];
	kind: "home" | "tracker" | "view" | "separator" | "user";
};

const navSheetOpenAtom = atom(false);
const searchOpenAtom = atom(false);

export const useNavSheetOpen = () => useAtomValue(navSheetOpenAtom);
export const useSetNavSheetOpen = () => useSetAtom(navSheetOpenAtom);
export const useSearchOpen = () => useAtomValue(searchOpenAtom);
export const useSetSearchOpen = () => useSetAtom(searchOpenAtom);

function sortByOrderThenName<T extends { sortOrder: number; name: string }>(
	items: T[],
): T[] {
	return [...items].sort((a, b) => {
		if (a.sortOrder !== b.sortOrder) {
			return a.sortOrder - b.sortOrder;
		}
		return a.name.localeCompare(b.name);
	});
}

function unwrapData<T>(body: { data: T[] } | undefined): T[] {
	return body?.data ?? [];
}

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
		const rawTrackers: ApiTracker[] = unwrapData(trackersQuery.data);
		const rawViews: ApiSavedView[] = unwrapData(viewsQuery.data);

		const enabledTrackers = rawTrackers.filter((t) => !t.isDisabled);
		const sortedTrackers = sortByOrderThenName(enabledTrackers);

		const enabledViews = rawViews.filter((v) => !v.isDisabled);
		const sortedViews = sortByOrderThenName(enabledViews);

		const trackerItems: NavigationItem[] = sortedTrackers.map((tracker) => {
			const trackerViews = sortedViews.filter(
				(view) => view.trackerId === tracker.id,
			);

			return {
				key: tracker.id,
				slug: tracker.slug,
				name: tracker.name,
				icon: tracker.icon,
				kind: "tracker" as const,
				accentColor: tracker.accentColor,
				subItems: trackerViews.map((view) => ({
					key: view.id,
					slug: view.slug,
					name: view.name,
					icon: view.icon,
					accentColor: view.accentColor,
				})),
			};
		});

		const standaloneViews = sortedViews.filter(
			(view) => view.trackerId === null,
		);

		const libraryViews: NavigationItem[] = standaloneViews.map((view) => ({
			key: view.id,
			subItems: [],
			slug: view.slug,
			name: view.name,
			icon: view.icon,
			kind: "view" as const,
			accentColor: view.accentColor,
		}));

		return { trackerItems, libraryViews };
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
