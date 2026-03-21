import type { AppSavedView } from "#/features/saved-views/model";
import {
	type AppTracker,
	sortTrackersByOrder,
} from "#/features/trackers/model";
import type { SidebarTracker, SidebarView } from "./Sidebar.types";

export function toSidebarData(input: {
	trackers: AppTracker[];
	views: AppSavedView[];
	isCustomizeMode?: boolean;
}): {
	views: SidebarView[];
	trackers: SidebarTracker[];
} {
	const visibleTrackers = input.isCustomizeMode
		? sortTrackersByOrder(input.trackers)
		: sortTrackersByOrder(input.trackers).filter(
				(tracker) => !tracker.isDisabled,
			);
	const trackerById = new Map(
		visibleTrackers.map((tracker) => [tracker.id, tracker]),
	);
	const trackers = visibleTrackers.map((tracker) => ({
		id: tracker.id,
		name: tracker.name,
		slug: tracker.slug,
		icon: tracker.icon,
		sortOrder: tracker.sortOrder,
		isBuiltin: tracker.isBuiltin,
		isDisabled: tracker.isDisabled,
		accentColor: tracker.accentColor,
		views: input.views
			.filter((view) => view.trackerId === tracker.id)
			.map((view) => ({
				id: view.id,
				icon: view.icon,
				name: view.name,
				trackerSlug: tracker.slug,
				trackerId: view.trackerId,
				accentColor: view.accentColor,
			})),
	}));
	const views = input.views
		.filter((view) => view.trackerId === null)
		.map((view) => ({
			id: view.id,
			icon: view.icon,
			name: view.name,
			trackerSlug: view.trackerId
				? (trackerById.get(view.trackerId)?.slug ?? null)
				: null,
			trackerId: view.trackerId,
			accentColor: view.accentColor,
		}));

	return { views, trackers };
}
