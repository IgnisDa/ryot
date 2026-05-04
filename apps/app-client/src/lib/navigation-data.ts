import type { paths } from "@ryot/generated/openapi/app-backend";

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
	kind: "home" | "tracker" | "view" | "separator" | "user";
	subItems: NavigationSubItem[];
	accentColor: string | null;
};

export function sortByOrderThenName<
	T extends { sortOrder: number; name: string },
>(items: T[]): T[] {
	return [...items].sort((a, b) => {
		if (a.sortOrder !== b.sortOrder) {
			return a.sortOrder - b.sortOrder;
		}
		return a.name.localeCompare(b.name);
	});
}

export function unwrapData<T>(body: { data: T[] } | undefined): T[] {
	return body?.data ?? [];
}

export function buildNavigationItems(
	trackers: ApiTracker[],
	views: ApiSavedView[],
) {
	const enabledTrackers = trackers.filter((t) => !t.isDisabled);
	const sortedTrackers = sortByOrderThenName(enabledTrackers);

	const enabledViews = views.filter((v) => !v.isDisabled);
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

	const standaloneViews = sortedViews.filter((view) => view.trackerId === null);
	const libraryViews: NavigationItem[] = standaloneViews.map((view) => ({
		key: view.id,
		slug: view.slug,
		name: view.name,
		icon: view.icon,
		kind: "view" as const,
		subItems: [],
		accentColor: view.accentColor,
	}));

	return { trackerItems, libraryViews };
}
